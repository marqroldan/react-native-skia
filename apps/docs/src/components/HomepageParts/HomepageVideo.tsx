import React from "react";

import styles from "../../pages/index.module.css";

export const HomepageVideo = () => (
  <div className={`container ${styles.videoContainer}`}>
    <iframe
      width="560"
      height="315"
      src="https://www.youtube.com/embed/EHxEX78alZE"
      title="YouTube video player"
      className={styles.video}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  </div>
);
