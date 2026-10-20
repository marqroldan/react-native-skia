import React from "react";
import Layout from "@theme/Layout";

import { HomepageHeader } from "../components/HomepageParts/HomepageHeader";
import { HomepageVideo } from "../components/HomepageParts/HomepageVideo";

// eslint-disable-next-line import/no-default-export
export default function Home() {
  //const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="React Native Skia"
      description="High Performance 2D Graphics"
    >
      <HomepageHeader />
      <main>
        <HomepageVideo />
      </main>
    </Layout>
  );
}
