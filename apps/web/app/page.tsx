import Link from "next/link";
import { ArrowRight, Camera, PenLine, Printer, ShieldCheck } from "lucide-react";

import { Brand } from "@/components/brand";

export default function HomePage() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <Brand />
        <div>
          <Link className="quiet-link" href="/login/">
            Sign in
          </Link>
          <Link className="button dark" href="/parent/">
            Open demo
          </Link>
        </div>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Made for learning together</p>
          <h1>
            Practice that
            <span>fits your child.</span>
          </h1>
          <p>
            Turn worksheets and learning goals into thoughtful practice. Children
            can type, handwrite, or work on paper.
          </p>
          <div className="hero-actions">
            <Link className="button primary large" href="/parent/">
              Explore the family demo
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="button ghost large" href="/child/work/">
              Try a worksheet
            </Link>
          </div>
        </div>
        <figure className="hero-visual" aria-label="A sample family worksheet">
          <div className="worksheet-card">
            <div className="worksheet-top">
              <span>Today&apos;s practice</span>
              <strong>2 of 5</strong>
            </div>
            <p className="worksheet-subject">Algebra · Standard</p>
            <h2>
              Show why <em>(a + b)(a − b) = a² − b²</em>
            </h2>
            <div className="writing-lines">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="worksheet-tools">
              <span>
                <PenLine size={17} aria-hidden="true" /> Handwritten response
              </span>
              <span>Saved as you work</span>
            </div>
          </div>
          <figcaption>
            <strong>Math can stay handwritten.</strong>
            <span>English answers can be typed or handwritten.</span>
          </figcaption>
        </figure>
      </section>
      <section className="landing-assurances" aria-label="How the workspace helps">
        <div>
          <ShieldCheck size={20} aria-hidden="true" />
          <span>
            <strong>Private by default</strong>
            Student work stays inside the family.
          </span>
        </div>
        <div>
          <Printer size={20} aria-hidden="true" />
          <span>
            <strong>Works with paper</strong>
            Print a worksheet and keep the familiar routine.
          </span>
        </div>
        <div>
          <Camera size={20} aria-hidden="true" />
          <span>
            <strong>Feedback after upload</strong>
            Photograph each answer, then review the full result.
          </span>
        </div>
      </section>
    </main>
  );
}
