import { newDb } from "./newdb";
import { oldDb } from "./olddb";
import { users as oldUsers } from "./olddb/schema";
import { accounts as oldAccounts } from "./olddb/schema";
import { users as newUsers } from "./newdb/schema";
import { accounts as newAccounts } from "./newdb/schema";
import { grades as oldGrades } from "./olddb/schema"
import { subjects as oldSubjects } from "./olddb/schema";
import { customAverages as oldAverages } from "./olddb/schema";
import { periods as oldPeriods } from "./olddb/schema";
import { generateId } from "./id";
import { years as newYears } from "./newdb/schema";
import { subjects as newSubjects } from "./newdb/schema";
import { periods as newPeriods } from "./newdb/schema";
import { customAverages as newCustomAverages } from "./newdb/schema";
import { grades as newGrades } from "./newdb/schema";

/**
 * Get all users
 */
const allUsers = await oldDb.select().from(oldUsers);
const allAccounts = await oldDb.select().from(oldAccounts);
const allGrades = await oldDb.select().from(oldGrades);
const allSubjects = await oldDb.select().from(oldSubjects);
const allAverages = await oldDb.select().from(oldAverages);
const allPeriods = await oldDb.select().from(oldPeriods);

console.log(`Found ${allUsers.length} users`);
console.log(`Found ${allAccounts.length} accounts`);
console.log(`Found ${allGrades.length} grades`);
console.log(`Found ${allSubjects.length} subjects`);
console.log(`Found ${allAverages.length} averages`);
console.log(`Found ${allPeriods.length} periods`);

const yearIds = new Map();

for (const user of allUsers) {
    yearIds.set(user.id, generateId("y"));
}

const years = allUsers.map((u) => {
    const bounds = getYearBounds(u.id);

    return {
        id: yearIds.get(u.id),
        name: "Année 1",
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        defaultOutOf: 20,
        createdAt: new Date(),
        userId: u.id,
    }
});

console.log(`Computed ${years.length} years`);

const subjects = allSubjects.map((s: any) => {
    return {
        ...s,
        yearId: yearIds.get(s.userId),
    }
});

console.log(`Computed ${subjects.length} subjects`);

const periods = allPeriods.map((p: any) => {
    return {
        ...p,
        yearId: yearIds.get(p.userId),
    }
});

console.log(`Computed ${periods.length} periods`);

const customAverages = allAverages.map((avg) => {
    return {
        ...avg,
        yearId: yearIds.get(avg.userId),
    }
});

console.log(`Computed ${customAverages.length} custom averages`);

const grades = allGrades.map((g) => {
    return {
        ...g,
        yearId: yearIds.get(g.userId),
    }
});

console.log(`Computed ${grades.length} grades`);

async function push() {
    await newDb.transaction(async (tx) => {
        // Backfill users data
        await tx.insert(newUsers).values(allUsers);
        await tx.insert(newAccounts).values(allAccounts);

        console.log("Pushed users and accounts");

        // Create year for each
        await tx.insert(newYears).values(years);

        console.log("Pushed years");

        await tx.insert(newSubjects).values(subjects);
        await tx.insert(newPeriods).values(periods);
        await tx.insert(newCustomAverages).values(customAverages);
        console.log("Pushed subjects, periods and custom averages");

        await tx.insert(newGrades).values(grades);
        console.log("Pushed grades");
    });
}

function getYearBounds(userId: string) {
    const userGrades = allGrades.filter(g => g.userId === userId);
    const sortedGrades = userGrades.sort((a, b) => b.passedAt.getTime() - a.passedAt.getTime());
    const lastGrade = sortedGrades[0];
    const firstGrade = sortedGrades[sortedGrades.length - 1];
    return {
        startDate: firstGrade ? firstGrade.passedAt : new Date("2024-01-01"),
        endDate: lastGrade ? lastGrade.passedAt : new Date("2025-12-31"),
    };
}

// push();