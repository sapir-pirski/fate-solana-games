import http from "k6/http";import {check,sleep} from "k6";
export const options={scenarios:{reads:{executor:"ramping-vus",stages:[{duration:"10s",target:10},{duration:"20s",target:25},{duration:"10s",target:0}]}},thresholds:{http_req_failed:["rate<0.01"],http_req_duration:["p(95)<750","p(99)<1500"],checks:["rate>0.99"]}};
const base=__ENV.BASE_URL||"http://host.docker.internal:3100";
export default function platformReadScenario(){const responses=http.batch([["GET",`${base}/api/health`],["GET",`${base}/api/indexer/games?type=jackpot&state=open`],["GET",`${base}/api/metrics`]]);check(responses[0],{"health 200":r=>r.status===200});check(responses[1],{"feed 200":r=>r.status===200});check(responses[2],{"metrics 200":r=>r.status===200});sleep(0.5);}
