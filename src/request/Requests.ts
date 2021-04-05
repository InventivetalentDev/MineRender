import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { JobQueue } from "jobqu";
import { Time } from "@inventivetalent/time";

if (typeof window === "undefined") {
    axios.defaults.headers["User-Agent"] = "MineRender";
}

export class Requests {

    private static axiosInstance: AxiosInstance = axios.create({});

    private static mcAssetInstance: AxiosInstance = axios.create({
    })

    private static mcAssetRequestQueue: JobQueue<AxiosRequestConfig, AxiosResponse>
        = new JobQueue<AxiosRequestConfig, AxiosResponse>(request => Requests.mcAssetInstance.request(request), Time.millis(10));

    public static genericRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.axiosInstance.request(request);
    }

    public static mcAssetRequest(request: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.mcAssetRequestQueue.add(request);
        // return Requests.mcAssetInstance.request(request)
    }

    public static setMcAssetRoot(root: string) {
        this.mcAssetInstance.defaults.baseURL = root;
    }

    public static get queueSizes() {
        return {
            mcAsset: this.mcAssetRequestQueue.size
        }
    }

}
