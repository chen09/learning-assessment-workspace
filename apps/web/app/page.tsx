import Link from "next/link";
import { ArrowRight, Camera, PenLine, Sparkles } from "lucide-react";

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
            Practice that understands
            <span>how your child works.</span>
          </h1>
          <p>
            Turn worksheets and learning goals into thoughtful practice. Type,
            handwrite, print, photograph, and get feedback one clear step at a time.
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
          <div className="trust-row">
            <span>Private by default</span>
            <span>Parent confirmed</span>
            <span>Built for paper too</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="A sample family worksheet">
          <div className="floating-note note-one">
            <Camera size={18} aria-hidden="true" />
            Paper scan ready
          </div>
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
                <PenLine size={17} aria-hidden="true" /> Handwrite
              </span>
              <button type="button">Clear</button>
            </div>
          </div>
          <div className="floating-note note-two">
            <Sparkles size={18} aria-hidden="true" />
            Hint, not answer
          </div>
        </div>
      </section>
    </main>
  );
}
