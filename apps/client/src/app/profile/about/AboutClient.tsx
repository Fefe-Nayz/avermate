"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Avatar from "@/components/buttons/account/avatar";
import { Button } from "@/components/ui/button";
import { Github, Star, ExternalLink } from "lucide-react";
import Link from "next/link";
import Logo from "@/components/logo";

interface AboutClientProps {
  repo: any;
  contributorsData: any;
  tags: any;
}

export default function AboutClient({
  repo,
  contributorsData,
  tags,
}: AboutClientProps) {
  const t = useTranslations("Settings.About");

  const version =
    tags && Array.isArray(tags) && tags.length > 0 ? tags[0].name : "v1.2.5";
  const githubLink = `https://github.com/${repo.owner?.login ?? "nayzflux"}/${
    repo.name ?? "avermate"
  }`;
  const stars = repo?.stargazers_count ?? 0;

  const usefulLinks = [
    { name: t("githubIssues"), url: `${githubLink}/issues` },
    { name: t("discordServer"), url: `https://discord.gg/DSCMg3MUzu` },
    { name: t("homePage"), url: `/` },
  ];

  return (
    <div className="flex flex-col gap-8 w-full">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex flex-col gap-2">
            <div className="pb-4">
              <Logo />
            </div>
            <CardTitle>
              {t("about", { name: repo?.name ?? "Your App" })}
            </CardTitle>
            {/* Add the description here */}
            <CardDescription>
              {repo?.description ?? t("defaultDescription")}
            </CardDescription>
          </div>
          <Badge variant="secondary">{version}</Badge>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              <Link
                href={githubLink}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
              >
                {t("viewOnGitHub")}
              </Link>
            </div>
            <div className="flex items-center gap-1">
              <Star className="h-4 w-4 text-yellow-400" />
              <span>{stars}</span>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">{t("contributors")}</h3>
            <div className="flex flex-wrap gap-2">
              {Array.isArray(contributorsData) &&
              contributorsData.length > 0 ? (
                contributorsData.map((contributor: any, index: number) => (
                  <Link
                    key={index}
                    href={contributor.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Avatar
                      size={40}
                      className="cursor-pointer"
                      src={contributor.avatar_url}
                    />
                  </Link>
                ))
              ) : (
                <p>{t("noContributors")}</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">{t("usefulLinks")}</h3>
            <div className="grid gap-2">
              {usefulLinks.map((link, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="w-full justify-start"
                  asChild
                >
                  <Link
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {link.name}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
