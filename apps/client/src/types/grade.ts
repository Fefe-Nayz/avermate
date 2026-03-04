import { PartialSubject } from "./subject";

export type Grade = {
  name: string;
  outOf: number;
  value: number;
  coefficient: number;
  passedAt: string;
  subjectId: string;
  id: string;
  createdAt: string;
  userId: string;
  subject: PartialSubject;
  periodId: string;
  yearId: string;
};

export type PartialGrade = Omit<Grade, "subject">;
