import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "10s", target: 100 },
    { duration: "10s", target: 0 },
  ],
};

export default function () {
  const res = http.get("http://localhost:3000/api/v1/auctions");

  check(res, {
    "status 200": (r) => r.status === 200,
  });
}