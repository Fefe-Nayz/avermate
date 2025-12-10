import { db } from "@/db";
import { grades, subjects } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

const app = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>();

const getYearReviewSchema = z.object({
  yearId: z.string().min(1),
});

app.get("/:yearId", zValidator("param", getYearReviewSchema), async (c) => {
  const session = c.get("session");
  if (!session) throw new HTTPException(401);

  const { yearId } = c.req.valid("param");

  // Fetch all grades for the user and year, with subject info
  const userGrades = await db.query.grades.findMany({
    where: and(eq(grades.userId, session.user.id), eq(grades.yearId, yearId)),
    with: {
      subject: true,
    },
    orderBy: [asc(grades.passedAt)],
  });

  if (userGrades.length === 0) {
     return c.json({
        hasData: false,
     })
  }

  // --- Calculations ---

  // 1. Number of entered grades
  const gradesCount = userGrades.length;

  // 2. Grades sum (normalized to 20)
  const gradesSum = userGrades.reduce((acc, g) => {
    const gradeVal = (g.value / g.outOf) * 20;
    return acc + gradeVal;
  }, 0);

  // 3. Heatmap, Most Active Month & Most Active Day
  const heatmap: Record<string, number> = {};
  const monthlyActivity: Record<string, number> = {};
  const dailyActivity: Record<string, number> = {};
  
  userGrades.forEach((g) => {
    const date = new Date(g.passedAt);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const monthStr = date.toLocaleString('default', { month: 'long' });
    const dayStr = date.toLocaleString('default', { weekday: 'long' });

    heatmap[dateStr] = (heatmap[dateStr] || 0) + 1;
    monthlyActivity[monthStr] = (monthlyActivity[monthStr] || 0) + 1;
    dailyActivity[dayStr] = (dailyActivity[dayStr] || 0) + 1;
  });

  let mostActiveMonth = { month: "", count: 0 };
  Object.entries(monthlyActivity).forEach(([month, count]) => {
    if (count > mostActiveMonth.count) {
      mostActiveMonth = { month, count };
    }
  });

  let mostActiveDay = { day: "", count: 0 };
  Object.entries(dailyActivity).forEach(([day, count]) => {
    if (count > mostActiveDay.count) {
      mostActiveDay = { day, count };
    }
  });

  // 4. Longest streak of average growth & Prime Time
  let longestStreak = 0;
  let currentStreak = 0;
  let currentAverage = 0;
  let totalWeight = 0;
  let weightedSum = 0;
  
  let primeTime = { date: new Date().toISOString(), value: 0 };
  
  userGrades.forEach((g, index) => {
    const gradeVal = (g.value / g.outOf) * 20;
    const coeff = g.coefficient / 100; 
    
    // Recalculate average
    weightedSum += gradeVal * coeff;
    totalWeight += coeff;
    const newAverage = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Streak logic
    if (index > 0) {
        if (newAverage > currentAverage) {
            currentStreak++;
        } else {
            currentStreak = 0;
        }
    }
    if (currentStreak > longestStreak) longestStreak = currentStreak;

    // Prime Time
    if (newAverage > primeTime.value) {
        primeTime = { date: g.passedAt.toISOString(), value: newAverage };
    }

    currentAverage = newAverage;
  });


  // 5. Best subjects & Progression
  const subjectsStats: Record<string, { 
    name: string; 
    sum: number; 
    weight: number; 
    grades: { value: number; outOf: number; date: Date }[] 
  }> = {};

  userGrades.forEach((g) => {
    if (!subjectsStats[g.subjectId]) {
        subjectsStats[g.subjectId] = {
            name: g.subject.name,
            sum: 0,
            weight: 0,
            grades: []
        };
    }
    const gradeVal = (g.value / g.outOf) * 20;
    const coeff = g.coefficient / 100;
    
    subjectsStats[g.subjectId].sum += gradeVal * coeff;
    subjectsStats[g.subjectId].weight += coeff;
    subjectsStats[g.subjectId].grades.push({
        value: g.value,
        outOf: g.outOf,
        date: g.passedAt
    });
  });

  // Calculate averages
  const subjectAverages = Object.values(subjectsStats).map(s => ({
    name: s.name,
    average: s.weight > 0 ? s.sum / s.weight : 0,
    grades: s.grades
  }));

  // Sort by average desc
  subjectAverages.sort((a, b) => b.average - a.average);
  const bestSubjects = subjectAverages.slice(0, 3).map(s => ({ name: s.name, value: s.average }));


  // Progression (Remontada)
  let bestProgression = { subject: "", value: -Infinity };

  Object.values(subjectsStats).forEach(s => {
      if (s.grades.length < 2) return;
      s.grades.sort((a, b) => a.date.getTime() - b.date.getTime());
      
      const first = (s.grades[0].value / s.grades[0].outOf) * 20;
      const last = (s.grades[s.grades.length - 1].value / s.grades[s.grades.length - 1].outOf) * 20;
      
      const diff = last - first;
      if (diff > bestProgression.value) {
          bestProgression = { subject: s.name, value: diff };
      }
  });

  if (bestProgression.value === -Infinity) {
      bestProgression = { subject: "N/A", value: 0 };
  }


  // 6. Top X% compared to other users (based on NUMBER of grades)
  
  // Get all grades for the year
  const allGradesInYear = await db
    .select({
        userId: grades.userId,
    })
    .from(grades)
    .where(eq(grades.yearId, yearId));

  const userGradeCounts: Record<string, number> = {};
  
  allGradesInYear.forEach(g => {
      userGradeCounts[g.userId] = (userGradeCounts[g.userId] || 0) + 1;
  });

  const finalCounts = Object.entries(userGradeCounts).map(([uid, count]) => ({
      userId: uid,
      count: count
  }));

  // Sort descending by count
  finalCounts.sort((a, b) => b.count - a.count);

  const myRankIndex = finalCounts.findIndex(u => u.userId === session.user.id);
  let topPercentile = 0;
  
  if (myRankIndex !== -1 && finalCounts.length > 0) {
      const percent = ((myRankIndex + 1) / finalCounts.length) * 100;
      topPercentile = finalCounts.length === 1 ? 1 : Math.ceil(percent);
  }

  return c.json({
    hasData: true,
    stats: {
        gradesCount,
        gradesSum,
        heatmap,
        mostActiveMonth,
        mostActiveDay,
        longestStreak,
        primeTime,
        bestSubjects,
        bestProgression,
        topPercentile
    }
  });
});

export default app;
