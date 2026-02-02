export const queryKeys = {
  years: {
    all: ["years"] as const,
    one: (id: string) => [...queryKeys.years.all, id] as const,
  },
  subjects: {
    all: (yearId: string) => ["subjects", yearId] as const,
    organized: (yearId: string) => ["subjects", "organized-by-periods", yearId] as const,
  },
  periods: {
    all: (yearId: string) => ["periods", yearId] as const,
  },
  grades: {
    recent: (yearId: string) => ["recent-grades", yearId] as const,
  },
  averages: {
    custom: (yearId: string) => ["custom-averages", yearId] as const,
    one: (id: string) => ["custom-averages", "detail", id] as const,
  },
  accounts: {
    all: ["accounts"] as const,
  },
};
