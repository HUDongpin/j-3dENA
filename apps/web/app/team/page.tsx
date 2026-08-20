import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Team",
  description: "The interdisciplinary researchers and developers behind 3D ENA.",
};

const members = [
  {
    name: "Prof. Gwo-Jen Hwang",
    role: "Chair Professor · Educational Technology",
    affiliation: "National Taichung University of Education",
    expertise: ["AI in education", "Mobile learning", "Game-based learning"],
    initials: "GH",
    href: "https://ibp.ntcu.edu.tw/",
  },
  {
    name: "Dr. Yun-Fang Tu",
    role: "Assistant Professor · Educational Technology",
    affiliation: "National Taiwan University of Science and Technology",
    expertise: ["Generative AI", "Educational data mining", "Network analysis"],
    initials: "YT",
    href: "https://doi.org/10.1016/j.compedu.2025.105397",
  },
  {
    name: "Dr. Peter Hu Dongpin",
    role: "Educational researcher · Application developer",
    affiliation: "Developer of 3D ENA Version 2.0",
    expertise: ["Learning analytics", "AI in education", "Application development"],
    initials: "PH",
    href: "/about",
  },
  {
    name: "Mr. Yu Jianxing",
    role: "Quantitative Ethnography · Application Development",
    affiliation: "3D ENA Research Group · Hong Kong",
    expertise: ["Epistemic network analysis", "Political discourse", "Research software"],
    initials: "YJ",
    href: "https://researchoutput.ncku.edu.tw/",
  },
  {
    name: "Dr. Huang Lingyun",
    role: "Assistant Professor · Curriculum and Instruction",
    affiliation: "The Education University of Hong Kong",
    expertise: ["AI-enabled analytics", "Regulated learning", "Teacher digital literacy"],
    initials: "HL",
    href: "https://repository.eduhk.hk/en/persons/lingyun-huang/",
  },
  {
    name: "Dr. Phoebe Kang Xia",
    role: "Senior Lecturer · Mathematics Education",
    affiliation: "Guangzhou University",
    expertise: ["Mathematics education", "Achievement emotions", "Measurement"],
    initials: "PK",
    href: "https://math.gzu.edu.cn/",
  },
  {
    name: "Dr. Wu Yajun",
    role: "Senior Lecturer · Applied Linguistics",
    affiliation: "Foshan University",
    expertise: ["Applied linguistics", "EFL motivation", "Student engagement"],
    initials: "WY",
    href: "https://www.fosu.edu.cn/",
  },
  {
    name: "Dr. Cao Yuan",
    role: "Postdoctoral Fellow · Curriculum and Instruction",
    affiliation: "The Education University of Hong Kong",
    expertise: ["Self-assessment", "Educational technology", "Learner engagement"],
    initials: "CY",
    href: "https://www.eduhk.hk/",
  },
  {
    name: "Dr. Li Jun",
    role: "Shadow Education · Education Policy",
    affiliation: "HKU Shadow Education SIG",
    expertise: ["Shadow education", "Education policy", "Social networks"],
    initials: "LJ",
    href: "https://doi.org/10.1111/ejed.70184",
  },
] as const;

export default function TeamPage() {
  return (
    <main id="main-content" className="site-main" data-testid="route-main">
      <section className="page-hero section-shell">
        <p className="eyebrow">Scholars and builders</p>
        <h1>Meet the team.</h1>
        <p className="page-lede">
          An interdisciplinary group united by an interest in how people learn,
          how evidence is modeled, and how technology can support better
          educational decisions.
        </p>
      </section>

      <section className="team-grid section-shell" aria-label="3D ENA team">
        {members.map((member, index) => {
          const external = member.href.startsWith("http");
          return (
            <article className="team-card" key={member.name}>
              <div className="team-card__portrait" aria-hidden="true">
                <span>{member.initials}</span>
                <small>{String(index + 1).padStart(2, "0")}</small>
              </div>
              <div className="team-card__copy">
                <p className="team-card__role">{member.role}</p>
                <h2>{member.name}</h2>
                <p>{member.affiliation}</p>
                <ul aria-label={`${member.name} research areas`}>
                  {member.expertise.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <a
                  href={member.href}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
                >
                  View profile <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
