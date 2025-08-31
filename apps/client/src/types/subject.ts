import { PartialGrade } from "./grade";

export type Subject = {
  name: string;
  coefficient: number;
  parentId: string | null;
  id: string;
  createdAt: Date;
  userId: string;
  depth: number;
  grades: PartialGrade[];
  isMainSubject: boolean;
  isDisplaySubject: boolean;
  yearId: string;
};

export type PartialSubject = Omit<
  Subject,
  "grades" | "coefficient" | "depth" | "createdAt" | "parentId" | "userId"
>;
