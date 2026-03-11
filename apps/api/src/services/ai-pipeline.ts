import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const DEFAULT_PROMPT = `Ты — профессиональный секретарь. Тебе предоставлены аудиозаписи звонка.
Каждый файл — отдельный участник, имя участника указано.

Создай сводку звонка на языке разговора.

## Участники
Кто был на звонке, примерно сколько говорил каждый.

## Ключевые решения
Что конкретно решили. Каждое решение — кто предложил, кто согласился.

## Задачи и дедлайны
- [ ] Задача — ответственный — срок (если озвучен)

## Открытые вопросы
Что обсуждали, но не решили.

## Краткое резюме
3-5 предложений: о чём был звонок и главный итог.

Правила:
- Привязывай каждый факт к конкретному человеку по имени
- Игнорируй small talk, приветствия, прощания
- Если участник почти не говорил — отметь это
- Не додумывай то, чего не было сказано
- Формат: Markdown`;

function getPrompt(): string {
  return process.env.SUMMARY_PROMPT || DEFAULT_PROMPT;
}

export interface TrackInfo {
  participantName: string;
  filePath: string;
}

export interface SummaryResult {
  summary: string;
  lang: string;
}

/**
 * Process call recording: send per-track audio files to Gemini and get summary.
 */
export async function processCallRecording(
  tracks: TrackInfo[],
  callLang: string = "ru"
): Promise<SummaryResult> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  // Build parts: prompt + audio files with participant names
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

  // System prompt
  const prompt = getPrompt();
  const langInstruction =
    callLang === "en"
      ? "\n\nIMPORTANT: The call was in English. Write the summary in English."
      : "\n\nВАЖНО: Звонок был на русском. Пиши сводку на русском языке.";

  parts.push({ text: prompt + langInstruction });

  // Add participant info
  const participantList = tracks
    .map((t) => `- ${t.participantName}`)
    .join("\n");
  parts.push({
    text: `\nУчастники звонка:\n${participantList}\n\nАудиозаписи каждого участника прикреплены ниже в том же порядке:`,
  });

  // Add audio files
  for (const track of tracks) {
    parts.push({ text: `\n--- Аудио участника: ${track.participantName} ---` });

    try {
      const audioData = fs.readFileSync(track.filePath);
      const base64 = audioData.toString("base64");

      parts.push({
        inlineData: {
          mimeType: "audio/ogg",
          data: base64,
        },
      });
    } catch (e) {
      console.error(`Failed to read audio file ${track.filePath}:`, e);
      parts.push({
        text: `[Аудиофайл ${track.participantName} не найден или повреждён]`,
      });
    }
  }

  // Call Gemini with retries
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await model.generateContent(parts);
      const text = result.response.text();

      if (!text || text.trim().length === 0) {
        throw new Error("Empty response from Gemini");
      }

      return {
        summary: text.trim(),
        lang: callLang,
      };
    } catch (e) {
      lastError = e as Error;
      console.error(
        `Gemini attempt ${attempt + 1}/3 failed:`,
        (e as Error).message
      );
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `AI pipeline failed after 3 attempts: ${lastError?.message}`
  );
}

/**
 * Clean up recording files after processing.
 */
export function cleanupRecordings(roomName: string): void {
  const dir = path.join(
    process.env.RECORDINGS_DIR || "/recordings",
    roomName
  );
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`Cleaned up recordings for room ${roomName}`);
    }
  } catch (e) {
    console.error(`Failed to cleanup recordings for ${roomName}:`, e);
  }
}
