import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 50,          // virtual users
  duration: "30s",  // test time
};

const BASE_URL = "http://localhost:3000";

export default function () {
  const payload = JSON.stringify({
    amount: Math.floor(Math.random() * 1000 + 100),
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${__ENV.BIDDER_TOKEN}`,
    },
  };

  const res = http.post(
    `${BASE_URL}/api/v1/auctions/${__ENV.AUCTION_ID}/bids`,
    payload,
    params
  );

  check(res, {
    "status is 200": (r) => r.status === 200,
  });

  sleep(1);
}