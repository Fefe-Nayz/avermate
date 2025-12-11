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

  // 7. Extra Stats for Awards
  
  // Global Average
  let globalSum = 0;
  let globalWeight = 0;
  let gradesUnder8Count = 0;
  
  userGrades.forEach(g => {
      const gradeVal = (g.value / g.outOf) * 20;
      const coeff = g.coefficient / 100;
      globalSum += gradeVal * coeff;
      globalWeight += coeff;
      
      if (gradeVal < 8) gradesUnder8Count++;
  });
  
  const average = globalWeight > 0 ? globalSum / globalWeight : 0;

  // First Month Average
  let firstMonthAverage = 0;
  if (userGrades.length > 0) {
      const sortedByDate = [...userGrades].sort((a, b) => a.passedAt.getTime() - b.passedAt.getTime());
      const firstDate = sortedByDate[0].passedAt;
      const oneMonthLater = new Date(firstDate);
      oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
      
      let fmSum = 0;
      let fmWeight = 0;
      
      sortedByDate.forEach(g => {
          if (g.passedAt <= oneMonthLater) {
              const gradeVal = (g.value / g.outOf) * 20;
              const coeff = g.coefficient / 100;
              fmSum += gradeVal * coeff;
              fmWeight += coeff;
          }
      });
      
      firstMonthAverage = fmWeight > 0 ? fmSum / fmWeight : 0;
  }

  // Worst Subject Average
  const worstSubjectAverage = subjectAverages.length > 0 
      ? subjectAverages[subjectAverages.length - 1].average 
      : 0;

  // StdDev Stats
  let stdDevHighCount = 0;
  let stdDevLowCount = 0;
  const totalSubjects = Object.keys(subjectsStats).length;

  Object.values(subjectsStats).forEach(s => {
      const avg = s.weight > 0 ? s.sum / s.weight : 0;
      let varianceSum = 0;
      
      s.grades.forEach(g => {
          const val = (g.value / g.outOf) * 20;
          varianceSum += Math.pow(val - avg, 2);
      });
      
      const variance = s.grades.length > 0 ? varianceSum / s.grades.length : 0;
      const stdDev = Math.sqrt(variance);
      
      if (stdDev > 4) stdDevHighCount++;
      if (stdDev < 2) stdDevLowCount++;
  });

  // Determine Award
  let award = {
        title: "Le Touriste",
        icon: "Plane",
        description: "Tu as mis quelques notes et tu es reparti. On ne sait pas si c'est de la confiance absolue ou du talent, mais on adore l'audace.",
        condition: "Moins de 15 notes",
        color: "text-pink-400",
        bg: "bg-pink-500/10 border-pink-500/20",
        gradient: "from-pink-400 to-rose-400"
  };

  if (average >= 10 && average <= 11 && gradesUnder8Count >= 3) {
      award = {
            title: "Le Funambule",
            icon: "Scale",
            description: "Tu as marché sur un fil toute l'année, le vide à gauche, le vide à droite... mais tu n'es jamais tombé. L'art de l'équilibre, le vrai.",
            condition: "Moyenne entre 10 et 11",
            color: "text-orange-400",
            bg: "bg-orange-500/10 border-orange-500/20",
            gradient: "from-orange-500 to-amber-500"
      };
  } else if (firstMonthAverage > 0 && average > firstMonthAverage + 2) {
      award = {
            title: "Le Roi du Comeback",
            icon: "RefreshCcw",
            description: "Le début de saison était compliqué. On a eu peur. Et puis tu as enclenché la seconde et tu as doublé tout le monde avant la ligne d'arrivée.",
            condition: "+2 pts vs début d'année",
            color: "text-emerald-400",
            bg: "bg-emerald-500/10 border-emerald-500/20",
            gradient: "from-emerald-500 to-green-500"
      };
  } else if (bestSubjects.length > 0 && (bestSubjects[0].value - worstSubjectAverage > 5)) {
       award = {
            title: "Le \"All In\"",
            icon: "Dices",
            description: "Pourquoi essayer d'être moyen partout quand on peut tout miser sur ses points forts ? Une stratégie risquée, mais payante.",
            condition: "+5 pts entre pire et meilleure matière",
            color: "text-red-400",
            bg: "bg-red-500/10 border-red-500/20",
            gradient: "from-red-500 to-rose-500"
        };
  } else if (average > 15) {
      award = {
            title: "La Masterclass",
            icon: "Crown",
            description: "Félicitations. Tu as plié l'année scolaire avec une facilité déconcertante.",
            condition: "Moyenne générale > 15",
            color: "text-yellow-400",
            bg: "bg-yellow-500/10 border-yellow-500/20",
            gradient: "from-yellow-400 to-amber-400"
      };
  } else if (totalSubjects > 0 && (stdDevHighCount / totalSubjects >= 0.25)) {
      award = {
            title: "L'Imprévisible",
            icon: "Shuffle",
            description: "Capable du génie absolu comme du ratage total au sein d'une même matière. Avec toi, c'est tout ou rien.",
            condition: "Notes variables dans +25% des matières",
            color: "text-purple-400",
            bg: "bg-purple-500/10 border-purple-500/20",
            gradient: "from-purple-500 to-violet-500"
      };
  } else if (totalSubjects > 0 && (stdDevLowCount / totalSubjects >= 0.5)) {
      award = {
            title: "La Précision",
            icon: "Crosshair",
            description: "Une régularité chirurgicale. Quand tu vises une note, tu l'atteins à chaque fois. Pas de mauvaises surprises, tu es une valeur sûre.",
            condition: "Notes régulières dans > 50% des matières",
            color: "text-blue-400",
            bg: "bg-blue-500/10 border-blue-500/20",
            gradient: "from-blue-400 to-cyan-400"
      };
  } else if (gradesCount >= 40) {
      award = {
            title: "Légende d'Avermate",
            icon: "Gem",
            description: "Ton suivi est tellement complet que tu connais ta moyenne mieux que tes profs. Tu ne fais plus qu'un avec l'application.",
            condition: "Plus de 40 notes",
            color: "text-cyan-400",
            bg: "bg-cyan-500/10 border-cyan-500/20",
            gradient: "from-cyan-400 to-sky-400"
      };
  } else if (gradesCount >= 15) {
      award = {
            title: "Avermatien",
            icon: "UserCheck",
            description: "Utilisateur certifié d'Avermate. Ni trop, ni trop peu. Tu gères ton année avec le sérieux d'un comptable. C'est carré.",
            condition: "Plus de 15 notes",
            color: "text-green-400",
            bg: "bg-green-500/10 border-green-500/20",
            gradient: "from-green-400 to-emerald-400"
      };
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
        topPercentile,
        average,
        award
    }
  });
});

export default app;
