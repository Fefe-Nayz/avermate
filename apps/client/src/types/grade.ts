import { PartialSubject } from "./subject";

export type GradeComponent = {
  id: string;
  gradeId: string;
  name: string;
  value: number;
  outOf: number;
  coefficient: number;
  createdAt: string;
  updatedAt: string;
  userId: string;
  yearId: string;
};

export type Grade = {
  name: string;
  outOf: number;
  value: number;
  coefficient: number;
  isComposite?: boolean;
  passedAt: string;
  subjectId: string;
  id: string;
  createdAt: string;
  userId: string;
  subject: PartialSubject;
  periodId: string;
  yearId: string;
  components?: GradeComponent[];
};

export type PartialGrade = Omit<Grade, "subject">;
