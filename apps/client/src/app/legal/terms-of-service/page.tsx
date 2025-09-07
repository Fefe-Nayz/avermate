"use client";

import React from "react";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const Tos = () => {
  const router = useRouter();
  const t = useTranslations("Legal.Tos");

  return (
    <div className="container mx-auto py-10">
      <div className="pb-8">
        <Logo />
      </div>
      <div className="pb-6">
        <Button onClick={() => router.back()}>
          <ArrowLeftIcon />
          {t("backButton")}
        </Button>
      </div>
      <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
        {t("title")}
      </h1>
      <p className="leading-7 not-first:mt-6">{t("lastUpdated")}</p>
      <p className="leading-7 not-first:mt-6">{t("intro.p1")}</p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("interpretationDefinitions.title")}
      </h2>
      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("interpretationDefinitions.interpretationTitle")}
      </h3>
      <p className="leading-7 not-first:mt-6">
        {t("interpretationDefinitions.interpretationText")}
      </p>
      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("interpretationDefinitions.definitionsTitle")}
      </h3>
      <p className="leading-7 not-first:mt-6">
        {t("interpretationDefinitions.definitionsIntro")}
      </p>
      <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.application", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.applicationStore", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.affiliate", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.country", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.company", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.device", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.service", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.termsAndConditions", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.thirdPartySocial", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.you", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
      </ul>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("acknowledgment.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">
        {t("acknowledgment.p1")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("acknowledgment.p2")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("acknowledgment.p3")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("acknowledgment.p4")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("acknowledgment.p5")}
      </p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("links.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">{t("links.p1")}</p>
      <p className="leading-7 not-first:mt-6">{t("links.p2")}</p>
      <p className="leading-7 not-first:mt-6">{t("links.p3")}</p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("termination.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">
        {t("termination.p1")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("termination.p2")}
      </p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("limitationOfLiability.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">
        {t("limitationOfLiability.p1")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("limitationOfLiability.p2")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("limitationOfLiability.p3")}
      </p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("asIs.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">{t("asIs.p1")}</p>
      <p className="leading-7 not-first:mt-6">{t("asIs.p2")}</p>
      <p className="leading-7 not-first:mt-6">{t("asIs.p3")}</p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("governingLaw.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">
        {t("governingLaw.p1")}
      </p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("disputesResolution.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">
        {t("disputesResolution.p1")}
      </p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("euUsers.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">{t("euUsers.p1")}</p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("usCompliance.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">
        {t("usCompliance.p1")}
      </p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("severability.title")}
      </h2>
      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("severability.subTitle1")}
      </h3>
      <p className="leading-7 not-first:mt-6">
        {t("severability.p1")}
      </p>
      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("severability.subTitle2")}
      </h3>
      <p className="leading-7 not-first:mt-6">
        {t("severability.p2")}
      </p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("translation.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">
        {t("translation.p1")}
      </p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("changes.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">{t("changes.p1")}</p>
      <p className="leading-7 not-first:mt-6">{t("changes.p2")}</p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("contactUs.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">
        {t("contactUs.text")}
      </p>
      <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
        <li>{t("contactUs.email")}</li>
      </ul>
    </div>
  );
};

export default Tos;
