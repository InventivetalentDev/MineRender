export interface BedrockEntityDescription {
    identifier: string;
    materials: { [k: string]: string };
    textures: { [k: string]: string };
    geometry: { [k: string]: string };
    scripts?: any;
    animations: { [k: string]: string };
    animation_controllers?: any;
    render_controllers: any;
    enable_attachables?: boolean;
}
