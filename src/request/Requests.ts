import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { JobQueue } from "jobqu";
import { Time } from "@inventivetalent/time";
import { prefix } from "../util/log";
import { sleep } from "../util";

const p = prefix("Requests");

if (typeof window === "undefined") {
    axios.defaults.headers["User-Agent"] = "MineRender";
}

export class Requests {

    private static axiosInstance: AxiosInstance = axios.create({
        timeout: 5000
    });

    private static mcAssetInstance: AxiosInstance = axios.create({
        timeout: 5000
    })

    private static genericQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => Requests.axiosInstance.request(request), Time.millis(10), 1);
    private static mcAssetRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => Requests.mcAssetInstance.request(request), Time.millis(10), 1);

    public static genericRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        // return this.axiosInstance.request(request);
        return this.genericQueue.add(request).catch(async e => {
            console.debug(p, "generic catch", e.code, e);

            // axios really likes to randomly cancel requests
            //  no idea why, but just keep retrying
            if (this.shouldRetry(e, request)) {
                await sleep(100);
                return this.genericRequest(request);
            }

            throw e;
        });
    }

    public static mcAssetRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.mcAssetRequestQueue.add(request).catch(e => {
            console.debug(p, "mcAssetRequest catch", e.code, e);
            throw e;
        });
        // return Requests.mcAssetInstance.request(request)
    }

    private static shouldRetry(e: any, request: AxiosRequestConfig): boolean {
        if ('code' in e) {
            if ('ECONNABORTED' === e.code) {
                if ('minerenderRetry' in request) {
                    if (request['minerenderRetry'] as number > 0) {
                        (request['minerenderRetry'] as number)--;
                        return true;
                    }
                } else {
                    request['minerenderRetry'] = 3;
                    return true;
                }
            }
        }
        return false;
    }

    public static setMcAssetRoot(root: string) {
        this.mcAssetInstance.defaults.baseURL = root;
    }

    public static get queueSizes() {
        return {
            generic: this.genericQueue.size,
            mcAsset: this.mcAssetRequestQueue.size
        }
    }

    /**
     * Stops both queue timers. jobqu reschedules itself indefinitely, so a Node process will not
     * exit until this is called - see {@link shutdown}.
     */
    public static end() {
        this.genericQueue.end();
        this.mcAssetRequestQueue.end();
    }

}
