import { DifferenceBadge } from "@/app/dashboard/grades/[gradeId]/difference-badge";
import DataCard from "@/components/dashboard/data-card";
import GradeValue from "@/components/dashboard/grade-value";
import {
  AcademicCapIcon,
  ArrowUpCircleIcon,
  SparklesIcon,
  VariableIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";

export const MockInsights = () => {
  const t = useTranslations("Landing.Product.Mocks.Insights");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 3xl:grid-cols-3 gap-4">
      <DataCard
        title={t("obtainedGrade")}
        description={t("obtainedGradeDescription")}
        icon={SparklesIcon}
      >
        <GradeValue outOf={2000} value={1650} />
      </DataCard>

      <DataCard
        title={t("impactOnOverallAverage")}
        description={t("impactOnOverallAverageDescription")}
        icon={ArrowUpCircleIcon}
      >
        <DifferenceBadge diff={0.358} />
      </DataCard>

      <DataCard
        className="hidden 3xl:flex"
        title={t("impactOnMathAverage")}
        description={t("impactOnMathAverageDescription")}
        icon={ArrowUpCircleIcon}
      >
        <DifferenceBadge diff={2.387} />
      </DataCard>

      <DataCard
        title={t("coefficient")}
        description={t("coefficientDescription")}
        icon={VariableIcon}
      >
        <p className="texl-xl md:text-3xl font-bold">2</p>
      </DataCard>

      <DataCard
        title={t("subject")}
        description={t("subjectDescription")}
        icon={AcademicCapIcon}
      >
        <p className="texl-xl md:text-3xl font-bold">{t("mathWritten")}</p>
      </DataCard>

      <DataCard
        title={t("examDate")}
        description={t("examDateDescription")}
        icon={AcademicCapIcon}
      >
        <p className="texl-xl md:text-3xl font-bold">
          {t("examDateValue")}
        </p>
      </DataCard>
    </div>
  );
};
