"use client"
import { Benefits } from "@/components/landing/benefits";
import { CTA } from "@/components/landing/cta";
import { FAQ } from "@/components/landing/faq";
import { Headline } from "@/components/landing/headline";
import { Product } from "@/components/landing/product";
import { SocialProof } from "@/components/landing/social-proof";
import Aurora from "@/components/landing/aurora";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function LandingPage() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dark = resolvedTheme === "dark";

  return (
    <div className="relative">
      {/* Aurora Background */}
      {mounted && (
        <div className="absolute top-0 left-0 w-full h-[100vh] z-0 pointer-events-none overflow-hidden">
          {/* Dark mode aurora - better darker colors */}
          <Aurora
            dark={dark}
            colorStops={
              dark
                ? ['#4338CA', '#059669', '#7C3AED']                // your dark palette
                : ['#BEE3FF', '#D9FFB5', '#EBD3FF']                  // pastel light palette
            }
            speed={0.8}
            blend={dark ? 0.4 : 0.6}
            amplitude={dark ? 1.2 : 1.0}
            // light-only tweaks
            edgeLift={1.0}
            bgColor={[1, 1, 1]} // page bg; omit/adjust if not pure white
            // mobile-friendly minimum sizes
            minWidth={1200}
            minHeight={800}
          />
        </div>
      )}

      {/* Content */}
      <div className="relative z-10">
        {/* Headline */}
        {/* CTA */}
        <Headline />

        {/* Social Proof */}
        <SocialProof />

        {/* Problems & Solutions */}
        <section id="benefits">
          <Benefits />
        </section>

        {/* Features */}
        <section id="features">
          <Product />
        </section>

        {/* Demo */}
        <section id="faq" className="pb-64">
          {/* CTA */}
          <CTA />

          {/* FAQ */}

          <FAQ />
        </section>
      </div>
    </div>
  );
}
