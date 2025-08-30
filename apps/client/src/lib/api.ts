import { env } from "@/lib/env";
import { Year } from "@/types/year";
import ky from "ky";

export const apiClient = ky.create({
  prefixUrl: env.NEXT_PUBLIC_API_URL + "/api",
  credentials: "include",
});