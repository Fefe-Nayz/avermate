export type AdminTimelineRange = number | "always";

export interface AdminManagedUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  emailVerified: boolean;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface AdminListUsersResponse {
  users: AdminManagedUser[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface AdminOverviewTimelinePoint {
  date: string;
  accounts: number;
  grades: number;
  subjects: number;
  newAccounts: number;
  newGrades: number;
  newSubjects: number;
}

export interface AdminOverviewTopUser {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned: boolean;
  gradeCount: number;
  lastGradeAt: string | null;
}

export interface AdminOverviewResponse {
  generatedAt: string;
  totals: {
    users: number;
    grades: number;
    subjects: number;
    years: number;
    periods: number;
    sessions: number;
    admins: number;
    bannedUsers: number;
  };
  health: {
    verifiedUsers: number;
    usersWithGrades: number;
    verificationRate: number;
    adoptionRate: number;
    averageGradesPerUser: number;
    averageGradesPerActiveUser: number;
    globalAverageOn20: number | null;
    passRateOn20: number | null;
  };
  last7Days: {
    newUsers: number;
    newGrades: number;
    activeUsers: number;
  };
  last30Days: {
    newUsers: number;
    newGrades: number;
    activeUsers: number;
  };
  distribution: {
    roles: Array<{
      role: string;
      count: number;
    }>;
    providers: Array<{
      providerId: string;
      count: number;
    }>;
  };
  topSubjects: Array<{
    id: string;
    name: string;
    gradeCount: number;
  }>;
  timeline: AdminOverviewTimelinePoint[];
  topUsers: AdminOverviewTopUser[];
  insights: {
    mostActiveDayByGrades: {
      date: string | null;
      count: number;
    };
    mostActiveDayByUsers: {
      date: string | null;
      count: number;
    };
  };
}

export interface AdminUserStatsTimelinePoint {
  date: string;
  grades: number;
  newGrades: number;
}

export interface AdminUserStatsResponse {
  generatedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    role: string;
    banned: boolean;
    banReason?: string | null;
    banExpires?: string | Date | null;
    createdAt: string | Date;
    updatedAt: string | Date;
  };
  totals: {
    grades: number;
    subjects: number;
    years: number;
    periods: number;
    sessions: number;
    accounts: number;
    customAverages: number;
  };
  last30Days: {
    newGrades: number;
  };
  gradeStats: {
    averageOn20: number | null;
    bestOn20: number | null;
    worstOn20: number | null;
  };
  timeline: AdminUserStatsTimelinePoint[];
  topSubjects: Array<{
    subjectId: string;
    name: string;
    gradeCount: number;
  }>;
  recentGrades: Array<{
    id: string;
    name: string;
    value: number;
    outOf: number;
    coefficient: number;
    createdAt: string | Date;
    passedAt: string | Date;
    subjectName: string | null;
  }>;
}
