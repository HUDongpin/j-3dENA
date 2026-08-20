import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = {
  title: "Papers",
  description: "Citation guidance and research foundations for 3D ENA.",
};

const papers = [
  {
    number: "01",
    type: "Foundational method",
    title:
      "Development of ENA 3D: A Tool for Epistemic Network Analysis in Three-Dimensional Space",
    citation:
      "Yu, J., Hu, D., & Wang, C.-H. (2024). Development of ENA 3D: A tool for epistemic network analysis in three-dimensional space. In Y. J. Kim & Z. Swiecki (Eds.), Advances in quantitative ethnography (pp. 152–165). Springer.",
    doi: "https://doi.org/10.1007/978-3-031-76335-9_11",
    featured: true,
  },
  {
    number: "02",
    type: "Application · political discourse",
    title: "The Application of ENA to Political Discourse in Taiwan: A Case Study",
    citation:
      "Yu, J., Hamilton, E., Wang, C.-H., & Hu, D. (2024). The application of ENA to political discourse in Taiwan: A case study. In Y. J. Kim & Z. Swiecki (Eds.), Advances in quantitative ethnography (pp. 273–287). Springer.",
    doi: "https://doi.org/10.1007/978-3-031-76332-8_22",
    featured: false,
  },
  {
    number: "03",
    type: "Application · learning research",
    title:
      "Effects on Learning Achievement and Multi-Stage Reflection in a Data Literacy Course",
    citation:
      "Tu, Y.-F., Hwang, G.-J., & Hu, D. (2025). Effects on the learning achievement, approaches to learning, and multi-stage reflection quality of students with different levels of digital self-efficacy in a data literacy course: An ARCS-based self-reflective online learning model. Computers & Education, 238, 105397.",
    doi: "https://doi.org/10.1016/j.compedu.2025.105397",
    featured: false,
  },
] as const;

export default function PapersPage() {
  return (
    <main id="main-content" className="site-main" data-testid="route-main">
      <section className="page-hero section-shell page-hero--split">
        <div>
          <p className="eyebrow">Research foundations</p>
          <h1>Cite the work behind 3D ENA.</h1>
          <p className="page-lede">
            If 3D ENA supports your analysis, begin with the foundational method
            paper. Add an application paper when it directly informs your study.
          </p>
        </div>
        <aside className="guidance-card">
          <p className="eyebrow">Citation guidance</p>
          <h2>Start with the method paper.</h2>
          <p>
            Citing the development paper recognizes the researchers and
            developers who created and advanced three-dimensional ENA.
          </p>
        </aside>
      </section>

      <section className="paper-library section-shell" aria-labelledby="paper-library-title">
        <div className="section-heading section-heading--row">
          <div>
            <p className="eyebrow">Selected literature</p>
            <h2 id="paper-library-title">Three references</h2>
          </div>
          <p>Follow each DOI to review the publisher record before citing.</p>
        </div>
        <div className="paper-list">
          {papers.map((paper) => (
            <article
              className={`paper-card${paper.featured ? " paper-card--featured" : ""}`}
              key={paper.doi}
            >
              <header>
                <span>{paper.number}</span>
                <span>{paper.type}</span>
              </header>
              <h3>{paper.title}</h3>
              <p>{paper.citation}</p>
              <a href={paper.doi} target="_blank" rel="noreferrer">
                View publication <ExternalLink size={16} aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
