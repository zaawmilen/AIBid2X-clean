import 'dotenv/config';
export declare const env: {
    DATABASE_URL: string;
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    APP_URL: string;
    DB_POOL_MAX: number;
    REDIS_URL: string;
    JWT_ACCESS_SECRET: string;
    JWT_REFRESH_SECRET: string;
    JWT_ACCESS_EXPIRES_IN: string;
    JWT_REFRESH_EXPIRES_IN: string;
    OPENAI_API_KEY?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
};
export declare const isDev: boolean;
export declare const isProd: boolean;
export declare const isTest: boolean;
//# sourceMappingURL=env.d.ts.map