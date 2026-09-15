import { useId } from "react";
import type { SetupStep } from "./model";

/** Local decorative artwork; it never represents a completed backup. */
export function SetupIllustration({ step }: { step: SetupStep | "saved" }) {
  const id = useId().replaceAll(":", "");
  const paint = (name: string) => `url(#${id}-${name})`;
  const welcome = step === "welcome" || step === "saved";
  return <svg className={`setup-illustration scene-${step}`} viewBox={welcome ? "0 0 480 248" : "0 0 100 82"} fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--setup-paper-top)" /><stop offset="1" stopColor="var(--setup-paper-bottom)" /></linearGradient>
      <linearGradient id={`${id}-blue`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#76c9ff" /><stop offset=".45" stopColor="#3193f1" /><stop offset="1" stopColor="#195dc1" /></linearGradient>
      <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#293a53" /><stop offset="1" stopColor="#111a2b" /></linearGradient>
      <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b2d4ff" stopOpacity=".5" /><stop offset="1" stopColor="#5a85b8" stopOpacity=".08" /></linearGradient>
    </defs>
    {welcome ? <>
      <g transform="translate(96 63) rotate(-16 49 59)"><g className="setup-art-paper">
        <rect width="98" height="118" rx="12" fill={paint("paper")} stroke="var(--setup-art-edge)" />
        <rect x="16" y="18" width="28" height="5" rx="2.5" fill="var(--setup-art-ink)" opacity=".7" />
        <path d="M16 42h65M16 53h65M16 64h43M16 85h56M16 96h36" stroke="var(--setup-art-ink)" strokeWidth="3" strokeLinecap="round" opacity=".3" />
      </g></g>
      <g transform="translate(284 69) rotate(14 48 54)"><g className="setup-art-photo">
        <rect width="100" height="113" rx="12" fill={paint("paper")} stroke="var(--setup-art-edge)" />
        <rect x="10" y="10" width="80" height="74" rx="6" fill="var(--selection)" />
        <circle cx="65" cy="30" r="8" fill="var(--accent)" opacity=".8" />
        <path d="m10 73 24-31 25 32 12-16 19 23v3H10Z" fill="var(--accent)" opacity=".5" />
        <path d="M16 98h48" stroke="var(--setup-art-ink)" strokeWidth="3" strokeLinecap="round" opacity=".4" />
      </g></g>
      <g className="setup-art-brand">
        <rect x="169" y="51" width="142" height="148" rx="34" fill="#000" opacity=".12" transform="translate(0 7)" />
        <rect x="169" y="44" width="142" height="148" rx="34" fill={paint("tile")} stroke={paint("edge")} strokeWidth="1.4" />
        <image href="./sentry-mark.png" x="193" y="67" width="94" height="101" />
        <path d="M204 185h71" stroke="#5d95d0" strokeOpacity=".15" strokeLinecap="round" />
      </g>
      <circle className="setup-art-spark" cx="123" cy="40" r="3" fill="var(--accent)" opacity=".45" />
      <circle className="setup-art-spark" cx="362" cy="193" r="2.5" fill="var(--accent)" opacity=".45" />
    </> : <g className="setup-art-symbol">
      {step === "sources" && <>
        <path d="M14 24a6 6 0 0 1 6-6h22l8 8h30a6 6 0 0 1 6 6v35H14Z" fill="#2365b7" />
        <rect x="27" y="11" width="41" height="45" rx="4" fill={paint("paper")} transform="rotate(8 47 33)" />
        <path d="M35 22h21M35 30h21M35 38h13" stroke="var(--setup-art-ink)" strokeWidth="2" opacity=".5" />
        <path d="M13 37h74l-6 32a5 5 0 0 1-5 4H24a5 5 0 0 1-5-4Z" fill={paint("blue")} stroke="#85caff" strokeOpacity=".5" />
      </>}
      {step === "destination" && <>
        <rect x="23" y="8" width="54" height="66" rx="12" fill={paint("paper")} stroke="var(--setup-art-edge)" />
        <path d="M33 20h34M33 26h34" stroke="var(--setup-art-ink)" opacity=".2" />
        <rect x="34" y="39" width="32" height="24" rx="5" fill={paint("blue")} />
        <path d="M41 39v-7a9 9 0 0 1 18 0v7" stroke="var(--accent)" strokeWidth="3" />
        <circle cx="50" cy="49" r="2" fill="white" /><path d="M50 50v5" stroke="white" strokeWidth="2" />
      </>}
      {step === "schedule" && <>
        <rect x="19" y="13" width="62" height="59" rx="12" fill={paint("paper")} stroke="var(--setup-art-edge)" />
        <path d="M19 26V23a10 10 0 0 1 10-10h42a10 10 0 0 1 10 10v3Z" fill={paint("blue")} />
        <path d="M35 9v9M65 9v9" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="50" cy="48" r="15" stroke="var(--setup-art-ink)" strokeWidth="2" opacity=".7" />
        <path d="M50 37v12l7 4" stroke="var(--setup-art-ink)" strokeWidth="2" strokeLinecap="round" />
      </>}
      {step === "review" && <>
        <rect x="26" y="7" width="48" height="65" rx="8" fill={paint("paper")} stroke="var(--setup-art-edge)" />
        <path d="M38 24h24M38 33h24M38 42h13" stroke="var(--setup-art-ink)" strokeWidth="2.5" strokeLinecap="round" opacity=".35" />
        <circle cx="67" cy="59" r="15" fill={paint("blue")} /><path d="m60 59 5 5 9-10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>}
    </g>}
  </svg>;
}

export function SetupBackground() {
  return <div className="setup-background" aria-hidden="true">
    <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
      <g className="setup-contour setup-contour-back">
        <path d="M-350 560C100 100 250 960 775 670S1220-150 1810 170" />
        <path d="M-350 594C100 134 250 994 775 704S1220-116 1810 204" />
        <path d="M-350 628C100 168 250 1028 775 738S1220-82 1810 238" />
      </g>
      <g className="setup-contour setup-contour-front">
        <path d="M-440 80C130-190 310 400 850 115S1480 40 1820 470" />
        <path d="M-440 105C130-165 310 425 850 140S1480 65 1820 495" />
      </g>
    </svg>
  </div>;
}
