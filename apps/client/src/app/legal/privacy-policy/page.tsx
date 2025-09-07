"use client";

import React from "react";
import Logo from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const PrivacyPolicy = () => {
  const router = useRouter();
  const t = useTranslations("Legal.Privacy");

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
      <p className="leading-7 not-first:mt-6">{t("intro.p2")}</p>

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
            {t.rich("interpretationDefinitions.list.account", {
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
            {t.rich("interpretationDefinitions.list.application", {
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
            {t.rich("interpretationDefinitions.list.country", {
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
            {t.rich("interpretationDefinitions.list.personalData", {
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
            {t.rich("interpretationDefinitions.list.serviceProvider", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("interpretationDefinitions.list.usageData", {
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
        {t("collectingUsingData.title")}
      </h2>
      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("collectingUsingData.typesDataCollectedTitle")}
      </h3>
      <h4 className="mt-8 scroll-m-20 text-xl font-semibold tracking-tight">
        {t("collectingUsingData.personalDataTitle")}
      </h4>
      <p className="leading-7 not-first:mt-6">
        {t("collectingUsingData.personalDataP1")}
      </p>
      <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
        <li>
          <p>{t("collectingUsingData.listEmail")}</p>
        </li>
        <li>
          <p>{t("collectingUsingData.listNames")}</p>
        </li>
        <li>
          <p>{t("collectingUsingData.listUsageData")}</p>
        </li>
      </ul>

      <h4 className="mt-8 scroll-m-20 text-xl font-semibold tracking-tight">
        {t("collectingUsingData.usageDataTitle")}
      </h4>
      <p className="leading-7 not-first:mt-6">
        {t("collectingUsingData.usageDataP1")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("collectingUsingData.usageDataP2")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("collectingUsingData.usageDataP3")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("collectingUsingData.usageDataP4")}
      </p>

      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("useOfPersonalData.title")}
      </h3>
      <p className="leading-7 not-first:mt-6">
        {t("useOfPersonalData.p1")}
      </p>
      <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
        <li>
          <p>
            {t.rich("useOfPersonalData.list1", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("useOfPersonalData.list2", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("useOfPersonalData.list3", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("useOfPersonalData.list4", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("useOfPersonalData.list5", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("useOfPersonalData.list6", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("useOfPersonalData.list7", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
        <li>
          <p>
            {t.rich("useOfPersonalData.list8", {
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </li>
      </ul>
      <p className="leading-7 not-first:mt-6">
        {t("useOfPersonalData.p2")}
      </p>
      <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
        <li>
          {t.rich("useOfPersonalData.listShare1", {
            b: (chunks) => <b>{chunks}</b>,
          })}
        </li>
        <li>
          {t.rich("useOfPersonalData.listShare2", {
            b: (chunks) => <b>{chunks}</b>,
          })}
        </li>
        <li>
          {t.rich("useOfPersonalData.listShare3", {
            b: (chunks) => <b>{chunks}</b>,
          })}
        </li>
        <li>
          {t.rich("useOfPersonalData.listShare4", {
            b: (chunks) => <b>{chunks}</b>,
          })}
        </li>
        <li>
          {t.rich("useOfPersonalData.listShare5", {
            b: (chunks) => <b>{chunks}</b>,
          })}
        </li>
        <li>
          {t.rich("useOfPersonalData.listShare6", {
            b: (chunks) => <b>{chunks}</b>,
          })}
        </li>
      </ul>

      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("retention.title")}
      </h3>
      <p className="leading-7 not-first:mt-6">
        {t("retention.p1")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("retention.p2")}
      </p>

      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("transfer.title")}
      </h3>
      <p className="leading-7 not-first:mt-6">{t("transfer.p1")}</p>
      <p className="leading-7 not-first:mt-6">{t("transfer.p2")}</p>
      <p className="leading-7 not-first:mt-6">{t("transfer.p3")}</p>

      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("deleteData.title")}
      </h3>
      <p className="leading-7 not-first:mt-6">
        {t("deleteData.p1")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("deleteData.p2")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("deleteData.p3")}
      </p>
      <p className="leading-7 not-first:mt-6">
        {t("deleteData.p4")}
      </p>

      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("disclosure.title")}
      </h3>
      <h4 className="mt-8 scroll-m-20 text-xl font-semibold tracking-tight">
        {t("disclosure.businessTitle")}
      </h4>
      <p className="leading-7 not-first:mt-6">
        {t("disclosure.businessText")}
      </p>

      <h4 className="mt-8 scroll-m-20 text-xl font-semibold tracking-tight">
        {t("disclosure.lawTitle")}
      </h4>
      <p className="leading-7 not-first:mt-6">
        {t("disclosure.lawText")}
      </p>

      <h4 className="mt-8 scroll-m-20 text-xl font-semibold tracking-tight">
        {t("disclosure.otherTitle")}
      </h4>
      <p className="leading-7 not-first:mt-6">
        {t("disclosure.otherText")}
      </p>
      <ul className="my-6 ml-6 list-disc [&>li]:mt-2">
        <li>{t("disclosure.otherList1")}</li>
        <li>{t("disclosure.otherList2")}</li>
        <li>{t("disclosure.otherList3")}</li>
        <li>{t("disclosure.otherList4")}</li>
        <li>{t("disclosure.otherList5")}</li>
      </ul>

      <h3 className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
        {t("security.title")}
      </h3>
      <p className="leading-7 not-first:mt-6">{t("security.p1")}</p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("children.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">{t("children.p1")}</p>
      <p className="leading-7 not-first:mt-6">{t("children.p2")}</p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("links.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">{t("links.p1")}</p>
      <p className="leading-7 not-first:mt-6">{t("links.p2")}</p>

      <h2 className="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0">
        {t("changes.title")}
      </h2>
      <p className="leading-7 not-first:mt-6">{t("changes.p1")}</p>
      <p className="leading-7 not-first:mt-6">{t("changes.p2")}</p>
      <p className="leading-7 not-first:mt-6">{t("changes.p3")}</p>

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

export default PrivacyPolicy;
