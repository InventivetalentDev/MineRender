import { Requests } from "../request/Requests";
import { Maybe } from "../util/util";

//TODO: cache stuff
export class Skins {


    //<editor-fold desc="Skins">

    static async fromUuid(uuid: string): Promise<Maybe<string>> {
        return this.getProfile(uuid).then(profile => {
            if (profile) {
                return profile.decoded.textures.SKIN?.url;
            }
            return undefined;
        })
    }

    static async fromUsername(username: string): Promise<Maybe<string>> {
        return this.usernameToUuid(username).then(uuid => {
            if (uuid) {
                return this.fromUuid(uuid);
            }
            return undefined;
        })
    }

    static async fromMineSkin(mineskinId: string): Promise<Maybe<string>> {
        return this.getMineSkin(mineskinId).then(mineskin => {
            if (mineskin) {
                return mineskin["data"]["texture"]["value"]["urls"]["skins"];
            }
            return undefined;
        })
    }

    //</editor-fold>


    //<editor-fold desc="Capes">

    static async capeFromUuid(uuid: string): Promise<Maybe<string>> {
        return this.getProfile(uuid).then(profile => {
            if (profile) {
                return profile.decoded.textures.CAPE?.url;
            }
            return undefined;
        })
    }

    static async capeFromUsername(username: string): Promise<Maybe<string>> {
        return this.usernameToUuid(username).then(uuid => {
            if (uuid) {
                return this.capeFromUuid(uuid);
            }
            return undefined;
        })
    }

    static async capeFromCapesDev(uuid: string, capeType: string = "minecraft"): Promise<Maybe<string>> {
        return this.getCapesDev(uuid, capeType).then(cape => {
            if (cape) {
                //TODO: support for animated
                return cape?.stillImageUrl;
            }
            return undefined;
        })
    }

    //</editor-fold>


    //<editor-fold desc="Helpers">

    private static async usernameToUuid(username: string): Promise<Maybe<string>> {
        return Requests.genericRequest({
            baseURL: 'https://api.minetools.eu',
            url: '/uuid/' + username
        }).then(res => {
            if (res.status === 200 && res.data["status"] === "OK") {
                return res.data["id"];
            }
            return undefined;
        }).catch(err => {
            console.warn(err);
            return undefined;
        })
    }

    private static async getProfile(uuid: string): Promise<Maybe<any>> {
        return Requests.genericRequest({
            baseURL: 'https://api.minetools.eu',
            url: '/profile/' + uuid
        }).then(res => {
            if (res.status === 200 && res.data["status"] === "OK") {
                return res.data;
            }
        })
    }

    private static async getMineSkin(mineskinId: string): Promise<Maybe<any>> {
        return Requests.genericRequest({
            baseURL: 'https://api.mineskin.org',
            url: '/get/uuid/' + mineskinId
        }).then(res => {
            if (res.status === 200) {
                return res.data;
            }
            return undefined;
        }).catch(err => {
            console.warn(err);
            return undefined;
        })
    }

    private static async getCapesDev(uuid: string, type: string = 'all'): Promise<Maybe<any>> {
        return Requests.genericRequest({
            baseURL: 'https://api.capes.dev',
            url: '/load/' + uuid + '/' + type
        }).then(res => {
            if (res.status === 200) {
                return res.data;
            }
            return undefined;
        }).catch(err => {
            console.warn(err);
            return undefined;
        })
    }
    
    //</editor-fold>


}
