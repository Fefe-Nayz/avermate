"use client";

import { useEffect, useMemo, useState } from "react";
import { HTTPError } from "ky";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Ban,
    Loader2,
    RefreshCcw,
    Search,
    Shield,
    ShieldCheck,
    Trash2,
    UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";

import { authClient } from "@/lib/auth";
import { useAdminOverview } from "@/hooks/use-admin-overview";
import { useAdminUserStats } from "@/hooks/use-admin-user-stats";
import { useAdminUsers } from "@/hooks/use-admin-users";
import { handleError } from "@/utils/error-utils";
import type { AdminManagedUser, AdminTimelineRange } from "@/types/admin";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
    SelectDrawer,
    SelectDrawerContent,
    SelectDrawerGroup,
    SelectDrawerItem,
    SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";

const USERS_PER_PAGE = 20;
const DEFAULT_TIMELINE_RANGE: AdminTimelineRange = 90;
const TIMELINE_RANGE_OPTIONS: AdminTimelineRange[] = [30, 90, 180, 365, "always"];

function parseRoleList(role: string | null | undefined): string[] {
    if (!role) {
        return [];
    }

    return role
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}

function isAdminRole(role: string | null | undefined): boolean {
    return parseRoleList(role).includes("admin");
}

function formatDate(value: string | Date | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatChartDate(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    });
}

function formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`;
}

function formatDecimal(value: number): string {
    return value.toFixed(2);
}

function formatProviderName(providerId: string): string {
    return providerId
        .split(/[-_]/g)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ");
}

function getStatusCode(error: unknown): number | undefined {
    if (error instanceof HTTPError) {
        return error.response.status;
    }

    if (typeof error === "object" && error !== null) {
        const maybeError = error as {
            status?: number;
            response?: { status?: number };
        };

        if (typeof maybeError.status === "number") {
            return maybeError.status;
        }

        if (typeof maybeError.response?.status === "number") {
            return maybeError.response.status;
        }
    }

    return undefined;
}

function MetricCard({
    title,
    value,
    description,
}: {
    title: string;
    value: string;
    description: string;
}) {
    return (
        <Card className="min-w-0">
            <CardHeader>
                <CardDescription>{title}</CardDescription>
                <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    );
}

export default function AdminDashboardPage() {
    const t = useTranslations("Dashboard.Pages.AdminPage");
    const tErrors = useTranslations("Errors");
    const queryClient = useQueryClient();

    const [timelineDays, setTimelineDays] = useState<AdminTimelineRange>(
        DEFAULT_TIMELINE_RANGE
    );
    const [searchInput, setSearchInput] = useState("");
    const [searchValue, setSearchValue] = useState("");
    const [page, setPage] = useState(1);
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [newUserName, setNewUserName] = useState("");
    const [newUserEmail, setNewUserEmail] = useState("");
    const [newUserPassword, setNewUserPassword] = useState("");
    const [newUserRole, setNewUserRole] = useState<"user" | "admin">("user");

    const { data: session, isPending: isSessionPending } = authClient.useSession();
    const isDataEnabled = !isSessionPending && Boolean(session);
    const offset = (page - 1) * USERS_PER_PAGE;

    useEffect(() => {
        const timeout = setTimeout(() => {
            setSearchValue(searchInput.trim());
            setPage(1);
        }, 300);

        return () => clearTimeout(timeout);
    }, [searchInput]);

    const overviewQuery = useAdminOverview(timelineDays, isDataEnabled);
    const usersQuery = useAdminUsers({
        searchValue,
        limit: USERS_PER_PAGE,
        offset,
        enabled: isDataEnabled,
    });
    const users = usersQuery.data?.users ?? [];

    useEffect(() => {
        if (!users.length) {
            setSelectedUserId(null);
            return;
        }

        if (!selectedUserId || !users.some((user) => user.id === selectedUserId)) {
            setSelectedUserId(users[0].id);
        }
    }, [users, selectedUserId]);

    const userStatsQuery = useAdminUserStats(
        selectedUserId,
        timelineDays,
        isDataEnabled
    );

    const currentUserId = session?.user?.id;
    const totalUsers = usersQuery.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalUsers / USERS_PER_PAGE));

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages);
        }
    }, [page, totalPages]);

    const isForbidden =
        getStatusCode(overviewQuery.error) === 403 ||
        getStatusCode(usersQuery.error) === 403 ||
        getStatusCode(userStatsQuery.error) === 403;

    const isLoadingInitial =
        isSessionPending ||
        (isDataEnabled && (overviewQuery.isPending || usersQuery.isPending));

    const refreshAdminData = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["admin"] }),
            queryClient.invalidateQueries({ queryKey: ["session"] }),
        ]);
    };

    const createUserMutation = useMutation({
        mutationKey: ["admin", "create-user"],
        mutationFn: async () => {
            return authClient.admin.createUser({
                name: newUserName.trim(),
                email: newUserEmail.trim(),
                password: newUserPassword,
                role: newUserRole,
            });
        },
        onSuccess: async () => {
            toast.success(t("toasts.userCreated"));
            setNewUserName("");
            setNewUserEmail("");
            setNewUserPassword("");
            setNewUserRole("user");
            await refreshAdminData();
        },
        onError: (error) => {
            handleError(error, tErrors, t("toasts.errors.createUser"));
        },
    });

    const setRoleMutation = useMutation({
        mutationKey: ["admin", "set-role"],
        mutationFn: async ({
            userId,
            role,
        }: {
            userId: string;
            role: "user" | "admin";
        }) => {
            return authClient.admin.setRole({
                userId,
                role,
            });
        },
        onSuccess: async () => {
            toast.success(t("toasts.roleUpdated"));
            await refreshAdminData();
        },
        onError: (error) => {
            handleError(error, tErrors, t("toasts.errors.updateRole"));
        },
    });

    const banMutation = useMutation({
        mutationKey: ["admin", "ban-user"],
        mutationFn: async (userId: string) => {
            return authClient.admin.banUser({
                userId,
                banReason: t("moderation.defaultBanReason"),
            });
        },
        onSuccess: async () => {
            toast.success(t("toasts.userBanned"));
            await refreshAdminData();
        },
        onError: (error) => {
            handleError(error, tErrors, t("toasts.errors.banUser"));
        },
    });

    const unbanMutation = useMutation({
        mutationKey: ["admin", "unban-user"],
        mutationFn: async (userId: string) => {
            return authClient.admin.unbanUser({
                userId,
            });
        },
        onSuccess: async () => {
            toast.success(t("toasts.userUnbanned"));
            await refreshAdminData();
        },
        onError: (error) => {
            handleError(error, tErrors, t("toasts.errors.unbanUser"));
        },
    });

    const removeUserMutation = useMutation({
        mutationKey: ["admin", "remove-user"],
        mutationFn: async (userId: string) => {
            return authClient.admin.removeUser({
                userId,
            });
        },
        onSuccess: async () => {
            toast.success(t("toasts.userDeleted"));
            await refreshAdminData();
        },
        onError: (error) => {
            handleError(error, tErrors, t("toasts.errors.deleteUser"));
        },
    });

    const isActionPending =
        setRoleMutation.isPending ||
        banMutation.isPending ||
        unbanMutation.isPending ||
        removeUserMutation.isPending;

    const selectedUser = useMemo(
        () => users.find((user) => user.id === selectedUserId) ?? null,
        [selectedUserId, users]
    );

    const timelineChartConfig = {
        accounts: {
            label: t("charts.accounts"),
            color: "#0ea5e9",
        },
        grades: {
            label: t("charts.grades"),
            color: "#22c55e",
        },
        subjects: {
            label: t("charts.subjects"),
            color: "#f97316",
        },
    };

    const userTimelineChartConfig = {
        grades: {
            label: t("charts.grades"),
            color: "#f97316",
        },
    };

    const timelineRangeLabels = {
        30: t("ranges.last30"),
        90: t("ranges.last90"),
        180: t("ranges.last180"),
        365: t("ranges.last365"),
        always: t("ranges.always"),
    } as const;

    const selectedTimelineRangeLabel =
        timelineRangeLabels[timelineDays as keyof typeof timelineRangeLabels] ??
        timelineRangeLabels[90];

    const selectedRoleLabel =
        newUserRole === "admin" ? t("roles.admin") : t("roles.user");

    const selectedUserLabel = selectedUser
        ? `${selectedUser.name} (${selectedUser.email})`
        : t("placeholders.selectUser");

    const handleCreateUser = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword) {
            toast.error(t("toasts.requiredFields"));
            return;
        }

        createUserMutation.mutate();
    };

    const handleToggleRole = (user: AdminManagedUser) => {
        const currentlyAdmin = isAdminRole(user.role ?? "user");
        const nextRole: "user" | "admin" = currentlyAdmin ? "user" : "admin";

        if (user.id === currentUserId && nextRole === "user") {
            toast.error(t("toasts.cannotDemoteSelf"));
            return;
        }

        setRoleMutation.mutate({
            userId: user.id,
            role: nextRole,
        });
    };

    const handleToggleBan = (user: AdminManagedUser) => {
        if (user.id === currentUserId) {
            toast.error(t("toasts.cannotBanSelf"));
            return;
        }

        if (user.banned) {
            unbanMutation.mutate(user.id);
            return;
        }

        banMutation.mutate(user.id);
    };

    const handleDeleteUser = (user: AdminManagedUser) => {
        if (user.id === currentUserId) {
            toast.error(t("toasts.cannotDeleteSelf"));
            return;
        }

        const confirmed = window.confirm(
            t("toasts.confirmDelete", { email: user.email })
        );

        if (!confirmed) {
            return;
        }

        removeUserMutation.mutate(user.id);
    };

    const metricCards = useMemo(() => {
        const overview = overviewQuery.data;

        return [
            {
                title: t("metrics.totalUsers.title"),
                value: String(overview?.totals.users ?? 0),
                description: t("metrics.totalUsers.description", {
                    count: overview?.last30Days.newUsers ?? 0,
                }),
            },
            {
                title: t("metrics.totalGrades.title"),
                value: String(overview?.totals.grades ?? 0),
                description: t("metrics.totalGrades.description", {
                    count: overview?.last30Days.newGrades ?? 0,
                }),
            },
            {
                title: t("metrics.activeUsers.title"),
                value: String(overview?.last30Days.activeUsers ?? 0),
                description: t("metrics.activeUsers.description"),
            },
            {
                title: t("metrics.bannedUsers.title"),
                value: String(overview?.totals.bannedUsers ?? 0),
                description: t("metrics.bannedUsers.description", {
                    count: overview?.totals.admins ?? 0,
                }),
            },
            {
                title: t("metrics.verificationRate.title"),
                value: formatPercentage(overview?.health.verificationRate ?? 0),
                description: t("metrics.verificationRate.description", {
                    count: overview?.health.verifiedUsers ?? 0,
                }),
            },
            {
                title: t("metrics.adoptionRate.title"),
                value: formatPercentage(overview?.health.adoptionRate ?? 0),
                description: t("metrics.adoptionRate.description", {
                    count: overview?.health.usersWithGrades ?? 0,
                }),
            },
            {
                title: t("metrics.globalAverage.title"),
                value:
                    overview?.health.globalAverageOn20 !== null &&
                        overview?.health.globalAverageOn20 !== undefined
                        ? formatDecimal(overview.health.globalAverageOn20)
                        : t("common.na"),
                description:
                    overview?.health.passRateOn20 !== null &&
                        overview?.health.passRateOn20 !== undefined
                        ? t("metrics.globalAverage.description", {
                            count: formatPercentage(overview.health.passRateOn20),
                        })
                        : t("metrics.globalAverage.descriptionWithoutPassRate"),
            },
            {
                title: t("metrics.gradesPerUser.title"),
                value: formatDecimal(overview?.health.averageGradesPerUser ?? 0),
                description: t("metrics.gradesPerUser.description", {
                    count: formatDecimal(overview?.health.averageGradesPerActiveUser ?? 0),
                }),
            },
        ];
    }, [overviewQuery.data, t]);

    return (
        <main className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-xl md:text-3xl font-bold">{t("title")}</h1>
                    <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <SelectDrawer
                        value={String(timelineDays)}
                        onValueChange={(value) =>
                            setTimelineDays(
                                value === "always" ? "always" : Number(value)
                            )
                        }
                    >
                        <SelectDrawerTrigger className="w-[190px]">
                            {selectedTimelineRangeLabel}
                        </SelectDrawerTrigger>
                        <SelectDrawerContent title={t("ranges.title")}>
                            <SelectDrawerGroup>
                                {TIMELINE_RANGE_OPTIONS.map((range) => (
                                    <SelectDrawerItem key={String(range)} value={String(range)}>
                                        {timelineRangeLabels[range as keyof typeof timelineRangeLabels]}
                                    </SelectDrawerItem>
                                ))}
                            </SelectDrawerGroup>
                        </SelectDrawerContent>
                    </SelectDrawer>

                    <Button
                        variant="outline"
                        onClick={() => refreshAdminData()}
                        disabled={!isDataEnabled}
                    >
                        <RefreshCcw className="size-4" />
                        {t("buttons.refresh")}
                    </Button>
                </div>
            </div>

            <Separator />

            {!isDataEnabled && !isSessionPending ? (
                <Card>
                    <CardHeader>
                        <CardTitle>{t("states.sessionRequiredTitle")}</CardTitle>
                        <CardDescription>{t("states.sessionRequiredDescription")}</CardDescription>
                    </CardHeader>
                </Card>
            ) : null}

            {isForbidden ? (
                <Card>
                    <CardHeader>
                        <CardTitle>{t("states.accessDeniedTitle")}</CardTitle>
                        <CardDescription>{t("states.accessDeniedDescription")}</CardDescription>
                    </CardHeader>
                </Card>
            ) : null}

            {isDataEnabled && !isForbidden ? (
                <>
                    {isLoadingInitial ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {Array.from({ length: 8 }).map((_, index) => (
                                <Card key={index} className="min-w-0">
                                    <CardHeader>
                                        <Skeleton className="h-4 w-20" />
                                        <Skeleton className="h-8 w-24" />
                                    </CardHeader>
                                    <CardContent>
                                        <Skeleton className="h-4 w-32" />
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {metricCards.map((metric) => (
                                <MetricCard
                                    key={metric.title}
                                    title={metric.title}
                                    value={metric.value}
                                    description={metric.description}
                                />
                            ))}
                        </div>
                    )}

                    <div className="grid gap-4 xl:grid-cols-3">
                        <Card className="min-w-0 overflow-hidden xl:col-span-2">
                            <CardHeader>
                                <CardTitle>{t("sections.growth.title")}</CardTitle>
                                <CardDescription>{t("sections.growth.description")}</CardDescription>
                            </CardHeader>
                            <CardContent className="min-w-0">
                                {overviewQuery.isPending ? (
                                    <Skeleton className="h-[300px] w-full" />
                                ) : (
                                    <div className="min-w-0 overflow-hidden">
                                        <ChartContainer config={timelineChartConfig} className="h-[300px] w-full min-w-0">
                                            <LineChart data={overviewQuery.data?.timeline ?? []}>
                                                <CartesianGrid vertical={false} />
                                                <XAxis
                                                    dataKey="date"
                                                    tickLine={false}
                                                    axisLine={false}
                                                    tickMargin={8}
                                                    minTickGap={24}
                                                    tickFormatter={(value) => formatChartDate(String(value))}
                                                />
                                                <YAxis
                                                    yAxisId="usersAxis"
                                                    tickLine={false}
                                                    axisLine={false}
                                                    tickMargin={8}
                                                    width={40}
                                                />
                                                <YAxis
                                                    yAxisId="gradesAxis"
                                                    orientation="right"
                                                    tickLine={false}
                                                    axisLine={false}
                                                    tickMargin={8}
                                                    width={40}
                                                />
                                                <ChartTooltip
                                                    cursor={false}
                                                    content={
                                                        <ChartTooltipContent
                                                            labelFormatter={(value) =>
                                                                formatDate(String(value)) ?? t("common.na")
                                                            }
                                                        />
                                                    }
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="accounts"
                                                    yAxisId="usersAxis"
                                                    stroke="var(--color-accounts)"
                                                    strokeWidth={2}
                                                    dot={false}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="subjects"
                                                    yAxisId="usersAxis"
                                                    stroke="var(--color-subjects)"
                                                    strokeWidth={2}
                                                    dot={false}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="grades"
                                                    yAxisId="gradesAxis"
                                                    stroke="var(--color-grades)"
                                                    strokeWidth={2}
                                                    dot={false}
                                                />
                                            </LineChart>
                                        </ChartContainer>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card className="min-w-0 overflow-hidden">
                            <CardHeader>
                                <CardTitle>{t("sections.topUsers.title")}</CardTitle>
                                <CardDescription>{t("sections.topUsers.description")}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {(overviewQuery.data?.topUsers ?? []).map((user) => (
                                    <div
                                        key={user.id}
                                        className="flex items-center justify-between gap-3 rounded-md border p-3"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{user.name}</p>
                                            <p className="truncate text-xs text-muted-foreground">
                                                {user.email}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-sm font-semibold">{user.gradeCount}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {t("sections.topUsers.gradesLabel")}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-3">
                        <Card className="min-w-0 overflow-hidden">
                            <CardHeader>
                                <CardTitle>{t("sections.distribution.title")}</CardTitle>
                                <CardDescription>{t("sections.distribution.description")}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <h3 className="text-sm font-semibold mb-2">
                                        {t("sections.distribution.rolesTitle")}
                                    </h3>
                                    <div className="space-y-2">
                                        {(overviewQuery.data?.distribution.roles ?? []).map((entry) => (
                                            <div
                                                key={entry.role}
                                                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                                            >
                                                <span className="min-w-0 truncate">{entry.role}</span>
                                                <Badge variant="outline">{entry.count}</Badge>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-semibold mb-2">
                                        {t("sections.distribution.providersTitle")}
                                    </h3>
                                    <div className="space-y-2">
                                        {(overviewQuery.data?.distribution.providers ?? []).map(
                                            (entry) => (
                                                <div
                                                    key={entry.providerId}
                                                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                                                >
                                                    <span className="min-w-0 truncate">
                                                        {formatProviderName(entry.providerId)}
                                                    </span>
                                                    <Badge variant="outline">{entry.count}</Badge>
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="min-w-0 overflow-hidden">
                            <CardHeader>
                                <CardTitle>{t("sections.subjects.title")}</CardTitle>
                                <CardDescription>{t("sections.subjects.description")}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {(overviewQuery.data?.topSubjects ?? []).map((subject) => (
                                    <div
                                        key={subject.id}
                                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                                    >
                                        <span className="min-w-0 truncate">{subject.name}</span>
                                        <Badge variant="secondary">{subject.gradeCount}</Badge>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="min-w-0 overflow-hidden">
                            <CardHeader>
                                <CardTitle>{t("sections.last7Days.title")}</CardTitle>
                                <CardDescription>{t("sections.last7Days.description")}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="rounded-md border p-3">
                                    <p className="text-xs text-muted-foreground">
                                        {t("sections.last7Days.newUsers")}
                                    </p>
                                    <p className="text-lg font-semibold">
                                        {overviewQuery.data?.last7Days.newUsers ?? 0}
                                    </p>
                                </div>
                                <div className="rounded-md border p-3">
                                    <p className="text-xs text-muted-foreground">
                                        {t("sections.last7Days.newGrades")}
                                    </p>
                                    <p className="text-lg font-semibold">
                                        {overviewQuery.data?.last7Days.newGrades ?? 0}
                                    </p>
                                </div>
                                <div className="rounded-md border p-3">
                                    <p className="text-xs text-muted-foreground">
                                        {t("sections.last7Days.activeUsers")}
                                    </p>
                                    <p className="text-lg font-semibold">
                                        {overviewQuery.data?.last7Days.activeUsers ?? 0}
                                    </p>
                                </div>
                                <div className="rounded-md border p-3">
                                    <p className="text-xs text-muted-foreground">
                                        {t("sections.last7Days.mostActiveGrades")}
                                    </p>
                                    <p className="text-sm font-semibold">
                                        {overviewQuery.data?.insights.mostActiveDayByGrades.date
                                            ? `${formatDate(
                                                overviewQuery.data.insights.mostActiveDayByGrades.date
                                            )} (${overviewQuery.data.insights.mostActiveDayByGrades.count})`
                                            : t("common.na")}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-3">
                        <Card className="min-w-0 overflow-hidden xl:col-span-2">
                            <CardHeader>
                                <CardTitle>{t("sections.userManagement.title")}</CardTitle>
                                <CardDescription>{t("sections.userManagement.description")}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-col gap-2 md:flex-row">
                                    <div className="relative flex-1">
                                        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                                        <Input
                                            value={searchInput}
                                            onChange={(event) => setSearchInput(event.target.value)}
                                            placeholder={t("placeholders.search")}
                                            className="pl-9"
                                        />
                                    </div>
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setSearchInput("");
                                            setSearchValue("");
                                            setPage(1);
                                        }}
                                    >
                                        {t("buttons.clear")}
                                    </Button>
                                </div>

                                <div className="overflow-hidden rounded-md border">
                                    <Table className="min-w-[780px]">
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>{t("table.user")}</TableHead>
                                                <TableHead>{t("table.status")}</TableHead>
                                                <TableHead>{t("table.role")}</TableHead>
                                                <TableHead className="hidden md:table-cell">
                                                    {t("table.created")}
                                                </TableHead>
                                                <TableHead className="text-right">{t("table.actions")}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {usersQuery.isPending ? (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="py-10 text-center">
                                                        <div className="inline-flex items-center gap-2 text-muted-foreground">
                                                            <Loader2 className="size-4 animate-spin" />
                                                            {t("table.loadingUsers")}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ) : users.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                                                        {t("table.noUsersFound")}
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                users.map((user) => {
                                                    const admin = isAdminRole(user.role ?? "user");
                                                    const selected = user.id === selectedUserId;

                                                    return (
                                                        <TableRow
                                                            key={user.id}
                                                            className={selected ? "bg-muted/40" : undefined}
                                                            onClick={() => setSelectedUserId(user.id)}
                                                        >
                                                            <TableCell>
                                                                <div className="min-w-0">
                                                                    <p className="truncate font-medium">
                                                                        {user.name}
                                                                    </p>
                                                                    <p className="truncate text-xs text-muted-foreground">
                                                                        {user.email}
                                                                    </p>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                {user.banned ? (
                                                                    <Badge variant="destructive">
                                                                        {t("status.banned")}
                                                                    </Badge>
                                                                ) : (
                                                                    <Badge variant="secondary">
                                                                        {t("status.active")}
                                                                    </Badge>
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                {admin ? (
                                                                    <Badge>
                                                                        <ShieldCheck className="size-3" />
                                                                        {t("roles.admin")}
                                                                    </Badge>
                                                                ) : (
                                                                    <Badge variant="outline">{t("roles.user")}</Badge>
                                                                )}
                                                            </TableCell>
                                                            <TableCell className="hidden md:table-cell">
                                                                {formatDate(user.createdAt) ?? t("common.na")}
                                                            </TableCell>
                                                            <TableCell className="text-right md:whitespace-nowrap">
                                                                <div className="flex flex-wrap items-center justify-end gap-1 md:flex-nowrap">
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        aria-label={
                                                                            admin ? t("actions.demote") : t("actions.promote")
                                                                        }
                                                                        disabled={isActionPending}
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            handleToggleRole(user);
                                                                        }}
                                                                    >
                                                                        <Shield className="size-3" />
                                                                        <span className="hidden sm:inline">
                                                                            {admin
                                                                                ? t("actions.demote")
                                                                                : t("actions.promote")}
                                                                        </span>
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        aria-label={
                                                                            user.banned
                                                                                ? t("actions.unban")
                                                                                : t("actions.ban")
                                                                        }
                                                                        disabled={isActionPending}
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            handleToggleBan(user);
                                                                        }}
                                                                    >
                                                                        <Ban className="size-3" />
                                                                        <span className="hidden sm:inline">
                                                                            {user.banned
                                                                                ? t("actions.unban")
                                                                                : t("actions.ban")}
                                                                        </span>
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="destructive"
                                                                        aria-label={t("actions.delete")}
                                                                        disabled={isActionPending}
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            handleDeleteUser(user);
                                                                        }}
                                                                    >
                                                                        <Trash2 className="size-3" />
                                                                        <span className="hidden sm:inline">
                                                                            {t("actions.delete")}
                                                                        </span>
                                                                    </Button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm text-muted-foreground">
                                        {t("pagination.pageOf", { page, total: totalPages })}
                                    </p>
                                    <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={page <= 1}
                                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                                        >
                                            {t("buttons.previous")}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={page >= totalPages}
                                            onClick={() =>
                                                setPage((current) => Math.min(totalPages, current + 1))
                                            }
                                        >
                                            {t("buttons.next")}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="flex min-w-0 flex-col gap-4">
                            <Card className="min-w-0 overflow-hidden">
                                <CardHeader>
                                    <CardTitle>{t("sections.createUser.title")}</CardTitle>
                                    <CardDescription>{t("sections.createUser.description")}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <form className="space-y-3" onSubmit={handleCreateUser}>
                                        <Input
                                            placeholder={t("placeholders.fullName")}
                                            value={newUserName}
                                            onChange={(event) => setNewUserName(event.target.value)}
                                        />
                                        <Input
                                            type="email"
                                            placeholder={t("placeholders.email")}
                                            value={newUserEmail}
                                            onChange={(event) => setNewUserEmail(event.target.value)}
                                        />
                                        <Input
                                            type="password"
                                            placeholder={t("placeholders.password")}
                                            value={newUserPassword}
                                            onChange={(event) => setNewUserPassword(event.target.value)}
                                        />

                                        <SelectDrawer
                                            value={newUserRole}
                                            onValueChange={(value) =>
                                                setNewUserRole(value as "user" | "admin")
                                            }
                                        >
                                            <SelectDrawerTrigger className="w-full">
                                                {selectedRoleLabel}
                                            </SelectDrawerTrigger>
                                            <SelectDrawerContent title={t("sections.createUser.roleTitle")}>
                                                <SelectDrawerGroup>
                                                    <SelectDrawerItem value="user">
                                                        {t("roles.user")}
                                                    </SelectDrawerItem>
                                                    <SelectDrawerItem value="admin">
                                                        {t("roles.admin")}
                                                    </SelectDrawerItem>
                                                </SelectDrawerGroup>
                                            </SelectDrawerContent>
                                        </SelectDrawer>

                                        <Button
                                            className="w-full"
                                            type="submit"
                                            disabled={createUserMutation.isPending}
                                        >
                                            {createUserMutation.isPending ? (
                                                <Loader2 className="size-4 animate-spin" />
                                            ) : (
                                                <UserPlus className="size-4" />
                                            )}
                                            {t("buttons.createUser")}
                                        </Button>
                                    </form>
                                </CardContent>
                            </Card>

                            <Card className="min-w-0 overflow-hidden">
                                <CardHeader>
                                    <CardTitle>{t("sections.selectedInsights.title")}</CardTitle>
                                    <CardDescription>
                                        {t("sections.selectedInsights.description")}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <p className="text-xs text-muted-foreground">
                                        {t("sections.selectedInsights.selectionHint")}
                                    </p>

                                    <SelectDrawer
                                        value={selectedUserId ?? ""}
                                        onValueChange={(value) => setSelectedUserId(value)}
                                    >
                                        <SelectDrawerTrigger className="w-full">
                                            {selectedUserLabel}
                                        </SelectDrawerTrigger>
                                        <SelectDrawerContent
                                            title={t("sections.selectedInsights.selectUserTitle")}
                                        >
                                            <SelectDrawerGroup>
                                                {users.map((user) => (
                                                    <SelectDrawerItem key={user.id} value={user.id}>
                                                        {user.name} ({user.email})
                                                    </SelectDrawerItem>
                                                ))}
                                            </SelectDrawerGroup>
                                        </SelectDrawerContent>
                                    </SelectDrawer>

                                    {!selectedUser ? (
                                        <p className="text-sm text-muted-foreground">
                                            {t("sections.selectedInsights.noUserSelected")}
                                        </p>
                                    ) : userStatsQuery.isPending ? (
                                        <Skeleton className="h-[220px] w-full" />
                                    ) : userStatsQuery.data ? (
                                        <>
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                <div className="rounded-md border p-3">
                                                    <p className="text-xs text-muted-foreground">
                                                        {t("sections.selectedInsights.grades")}
                                                    </p>
                                                    <p className="text-lg font-semibold">
                                                        {userStatsQuery.data.totals.grades}
                                                    </p>
                                                </div>
                                                <div className="rounded-md border p-3">
                                                    <p className="text-xs text-muted-foreground">
                                                        {t("sections.selectedInsights.subjects")}
                                                    </p>
                                                    <p className="text-lg font-semibold">
                                                        {userStatsQuery.data.totals.subjects}
                                                    </p>
                                                </div>
                                                <div className="rounded-md border p-3">
                                                    <p className="text-xs text-muted-foreground">
                                                        {t("sections.selectedInsights.averageOn20")}
                                                    </p>
                                                    <p className="text-lg font-semibold">
                                                        {userStatsQuery.data.gradeStats.averageOn20 !== null
                                                            ? formatDecimal(userStatsQuery.data.gradeStats.averageOn20)
                                                            : t("common.na")}
                                                    </p>
                                                </div>
                                                <div className="rounded-md border p-3">
                                                    <p className="text-xs text-muted-foreground">
                                                        {t("sections.selectedInsights.last30DaysGrades")}
                                                    </p>
                                                    <p className="text-lg font-semibold">
                                                        {userStatsQuery.data.last30Days.newGrades}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="min-w-0 overflow-hidden">
                                                <ChartContainer
                                                    config={userTimelineChartConfig}
                                                    className="h-[220px] w-full min-w-0"
                                                >
                                                    <LineChart data={userStatsQuery.data.timeline}>
                                                        <CartesianGrid vertical={false} />
                                                        <XAxis
                                                            dataKey="date"
                                                            tickLine={false}
                                                            axisLine={false}
                                                            tickMargin={8}
                                                            minTickGap={24}
                                                            tickFormatter={(value) => formatChartDate(String(value))}
                                                        />
                                                        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={36} />
                                                        <ChartTooltip
                                                            cursor={false}
                                                            content={
                                                                <ChartTooltipContent
                                                                    labelFormatter={(value) =>
                                                                        formatDate(String(value)) ?? t("common.na")
                                                                    }
                                                                />
                                                            }
                                                        />
                                                        <Line
                                                            type="monotone"
                                                            dataKey="grades"
                                                            stroke="var(--color-grades)"
                                                            strokeWidth={2}
                                                            dot={false}
                                                        />
                                                    </LineChart>
                                                </ChartContainer>
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            {t("sections.selectedInsights.loadError")}
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </>
            ) : null}
        </main>
    );
}
