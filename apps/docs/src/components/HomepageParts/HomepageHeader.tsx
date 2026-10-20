import React from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";

import styles from "../../pages/index.module.css";

export const HomepageHeader = () => {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        {/* <img src="/img/skia2.png" alt="Skia" height="200" width="auto" /> */}
        <h1 className={clsx("hero__title", styles.heroText)}>
          {siteConfig.title}
        </h1>
        <p className={clsx("hero__subtitle", styles.heroText)}>
          {siteConfig.tagline}
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/installation"
          >
            Documentation
          </Link>
        </div>
      </div>
    </header>
  );
};
