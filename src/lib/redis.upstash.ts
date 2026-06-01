import { Redis } from "@upstash/redis";
import {env} from '../config/env.js';

export const upstashRedis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});