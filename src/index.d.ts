export interface DocsConfig {
  title: string;
  description?: string;
  color?: string;
  icon?: string | { background?: string; color?: string; border?: string };
  deploy?: {
    project: string;
    access: {
      teamDomain: string;
      audiences: string[];
      emails: string[];
    };
  };
  tabs: Array<{ title: string; dir: string; slug: string }>;
}
export declare function defineConfig(config: DocsConfig): DocsConfig;
