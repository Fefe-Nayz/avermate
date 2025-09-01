"use client"
import { Benefits } from "@/components/landing/benefits";
import { CTA } from "@/components/landing/cta";
import { FAQ } from "@/components/landing/faq";
import { Headline } from "@/components/landing/headline";
import { Product } from "@/components/landing/product";
import { SocialProof } from "@/components/landing/social-proof";
import Aurora from "@/components/landing/aurora";

export default function LandingPage() {
  return (
    <div className="relative">
      {/* Aurora Background */}
      <div className="absolute top-0 left-0 w-full h-[100vh] z-0 pointer-events-none overflow-hidden">
        <Aurora
          colorStops={['#5227FF', '#7cff67', '#B19EEF']}
          speed={0.8}
          blend={0.4}
          amplitude={1.2}
        />
      </div>

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

        {/* CTA */}
        <CTA />

        {/* FAQ */}
        <section id="faq" className="pb-64">
          <FAQ />
        </section>
      </div>
    </div>
  );
}
