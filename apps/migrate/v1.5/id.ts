import { customAlphabet } from "nanoid";

/**
u - user
acc - account
ses - session
ver - verification
sub - subject
gra - grade
per - period
ca - custom average
ct - card template
cl - card layout
y - year
*/

type IdPrefix = "u" | "acc" | "ses" | "ver" | "sub" | "gra" | "per" | "ca" | "ct" | "cl" | "y";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const nanoid = customAlphabet(ALPHABET, 16);

export const generateId = (prefix: IdPrefix, size?: number) => {
  const id = nanoid(size);
  return prefix + "_" + id;
};
