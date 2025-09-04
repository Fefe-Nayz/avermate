import OpenAi from "openai";
import { env } from "./env";

export const aiClient = new OpenAi({
    apiKey: env.OPENAI_API_KEY,
});