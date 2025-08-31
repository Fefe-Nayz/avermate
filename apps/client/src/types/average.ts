export type Average = {
    id: string;
    name: string;
    subjects: {
        id: string;
        customCoefficient: number | null;
        includeChildren: boolean | null;
    }[];
    isMainAverage: boolean;
    createdAt: number;
    userId: string;
    yearId: string;
};