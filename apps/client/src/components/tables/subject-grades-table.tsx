"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronDown,
  MoreHorizontal,
  Columns3CogIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PartialGrade } from "@/types/grade";
import GradeBadge from "./grade-badge";
import GradeMoreButton from "../buttons/dashboard/grade/grade-more-button";
import { useFormatter, useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import Link from "next/link";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropDrawer,
  DropDrawerCheckboxItem,
  DropDrawerContent,
  DropDrawerGroup,
  DropDrawerItem,
  DropDrawerTrigger,
} from "@/components/ui/dropdrawer";

// Build columns with a factory so hooks stay inside components
function makeColumns(
  t: ReturnType<typeof useTranslations>,
  formatPassedAtRef: React.RefObject<(d: unknown) => string>
): ColumnDef<PartialGrade>[] {
  return [
    // {
    //     id: "select",
    //     header: ({ table }) => (
    //         <Checkbox
    //             checked={
    //                 table.getIsAllPageRowsSelected() ||
    //                 (table.getIsSomePageRowsSelected() && "indeterminate")
    //             }
    //             onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
    //             aria-label="Select all"
    //         />
    //     ),
    //     cell: ({ row }) => (
    //         <Checkbox
    //             checked={row.getIsSelected()}
    //             onCheckedChange={(value) => row.toggleSelected(!!value)}
    //             aria-label="Select row"
    //         />
    //     ),
    //     enableSorting: false,
    //     enableHiding: false,
    // },
    {
      accessorKey: "name",
      enableResizing: false,
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {t("HEADER_NAME")}
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ row }) => (
        <Link
          href={`/dashboard/grades/${row.original.id}/${row.original.periodId}`}
        >
          <p className="font-semibold underline truncate text-ellipsis max-w-[160px] md:max-w-[300px] xl:max-w-full">
            {row.getValue("name")}
          </p>
        </Link>
      ),
    },
    {
      id: "grade",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {t("HEADER_GRADE")}
          <ArrowUpDown />
        </Button>
      ),
      accessorFn: (row) => {
        // Calculate percentage for sorting (value / outOf)
        return row.value / row.outOf;
      },
      cell: ({ row }) => {
        const { id, value, coefficient, periodId, subjectId, outOf } =
          row.original;
        return (
          <div>
            <GradeBadge
              id={id}
              value={value}
              coefficient={coefficient}
              periodId={periodId}
              subjectId={subjectId}
              outOf={outOf}
            />
          </div>
        );
      },
    },
    {
      accessorKey: "passedAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {t("HEADER_PASSED_AT")}
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ row }) => (
        <div>{formatPassedAtRef.current?.(row.getValue("passedAt")) ?? ""}</div>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => {
        const grade = row.original;
        return (
          <div className="flex justify-end">
            <GradeMoreButton grade={grade} />
          </div>
        );
      },
    },
  ];
}

export function SubjectGradesTable({ grades }: { grades: PartialGrade[] }) {
  const t = useTranslations("Dashboard.Tables.SUBJECT_GRADES_TABLE");
  const formatter = useFormatter();
  const formatDates = useFormatDates(formatter);

  // Stable formatter ref used by column cell without changing the columns identity
  const formatPassedAtRef = React.useRef<(d: unknown) => string>(() => "");
  React.useEffect(() => {
    formatPassedAtRef.current = (d: unknown) =>
      formatDates.formatIntermediate(d as any);
  }, [formatDates]);

  const isMobile = useIsMobile();

  // Track <400px
  const [isUnder400px, setIsUnder400px] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false; // SSR-safe default
    return window.innerWidth < 400;
  });

  // Has the user explicitly changed 'passedAt' visibility?
  const [userOverrodePassedAt, setUserOverrodePassedAt] = React.useState(false);

  React.useEffect(() => {
    const onResize = () => setIsUnder400px(window.innerWidth < 400);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Columns & names
  const columns = React.useMemo<ColumnDef<PartialGrade>[]>(
    () => makeColumns(t, formatPassedAtRef),
    [t]
  );
  const columnNames = React.useMemo(
    () => ({
      name: t("HEADER_NAME"),
      grade: t("HEADER_GRADE"),
      passedAt: t("HEADER_PASSED_AT"),
    }),
    [t]
  );

  // Visibility: initialize from current width; resize can update it unless user overrides
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(() => ({
      passedAt: !isUnder400px, // true if >= 400px, false if < 400px
    }));

  // Keep passedAt in sync with width until the user overrides it
  React.useEffect(() => {
    if (userOverrodePassedAt) return;
    setColumnVisibility((prev) => ({ ...prev, passedAt: !isUnder400px }));
  }, [isUnder400px, userOverrodePassedAt]);

  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [rowSelection, setRowSelection] = React.useState({});

  const table = useReactTable({
    data: grades,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="w-full">
      <div className="flex items-center py-4 gap-2">
        <Input
          placeholder={t("FILTER_NAME_PLACEHOLDER")}
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(event) =>
            table.getColumn("name")?.setFilterValue(event.target.value)
          }
          className={`flex-1 ${isMobile ? "max-w-none" : "max-w-sm md:max-w-[40%]"}`}
        />
        <DropDrawer>
          <DropDrawerTrigger asChild>
            <Button
              variant="outline"
              className={`ml-auto ${isMobile ? "h-9 w-9 p-0" : ""}`}
            >
              <Columns3CogIcon className="h-4 w-4" />
              {!isMobile && <span className="ml-2">{t("COLUMNS")}</span>}
            </Button>
          </DropDrawerTrigger>
          <DropDrawerContent align="end" title={t("COLUMNS")}>
            <DropDrawerGroup>
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  const isPassedAt = column.id === "passedAt";
                  return (
                    <DropDrawerCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      // Mark override ONLY when user clicks for 'passedAt'
                      onCheckedChange={() => {
                        if (isPassedAt) setUserOverrodePassedAt(true);
                        column.toggleVisibility();
                      }}
                      className="w-full capitalize"
                    >
                      {columnNames[column.id as keyof typeof columnNames] ||
                        column.id}
                    </DropDrawerCheckboxItem>
                  );
                })}
            </DropDrawerGroup>
          </DropDrawerContent>
        </DropDrawer>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {t("FILTER_NO_RESULTS")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end space-x-2 py-4">
        {/* <div className="text-muted-foreground flex-1 text-sm">
                    {table.getFilteredSelectedRowModel().rows.length} of{" "}
                    {table.getFilteredRowModel().rows.length} row(s) selected.
                </div> */}
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {t("BUTTON_PREVIOUS")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t("BUTTON_NEXT")}
          </Button>
        </div>
      </div>
    </div>
  );
}
