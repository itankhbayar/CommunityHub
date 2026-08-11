import { ClosingCta } from '@/components/home/ClosingCta';
import { FeaturedCommunities } from '@/components/home/FeaturedCommunities';
import { Features } from '@/components/home/Features';
import { Hero } from '@/components/home/Hero';
import { HowItWorks } from '@/components/home/HowItWorks';

export default function Home() {
  return (
    <>
      <Hero />
      <FeaturedCommunities />
      <Features />
      <HowItWorks />
      <ClosingCta />
    </>
  );
}
