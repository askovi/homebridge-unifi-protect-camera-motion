import type { API, DynamicPlatformPlugin, Logger, PlatformConfig} from 'homebridge';
import {APIEvent, Categories} from 'homebridge';
import {Utils} from "./utils/utils";
import {Unifi} from "./unifi/unifi";
import {UnifiFlows} from "./unifi/unifi-flows";
import {MotionDetector} from "./motion/motion";
import {PLUGIN_NAME} from "./settings";
import {VideoConfig} from "./ffmpeg/video-config";
import {CameraConfig} from "./ffmpeg/camera-config";

const FFMPEG = require('homebridge-camera-ffmpeg/ffmpeg.js').FFMPEG;
const FFMPEG_PATH = require('ffmpeg-for-homebridge');

export class UnifiProtectMotionPlatform implements DynamicPlatformPlugin {

    public readonly Service = this.api.hap.Service;
    public readonly Characteristic = this.api.hap.Characteristic;
    public readonly PlatformAccessory = this.api.platformAccessory;

    constructor(
        public readonly logger: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
            //Hack to get async functions!
            setTimeout(async () => {
                this.discoverDevices();
            });
        });
    }

    public configureAccessory(accessory: any): void {
        //Not used for now!
    }

    private async discoverDevices(): Promise<void> {
        let videoProcessor = this.config.videoProcessor || 'ffmpeg';
        const interfaceName = this.config.interfaceName || '';

        if (this.config.videoConfig) {
            const configuredAccessories: any[] = [];
            const infoLogger = Utils.createLogger(this.logger, true, false);
            const debugLogger = Utils.createLogger(this.logger, false, this.config.unifi.debug);

            const unifi = new Unifi(
                this.config.unifi,
                500,
                2,
                infoLogger
            );
            const uFlows = new UnifiFlows(
                unifi,
                this.config.unifi,
                await Unifi.determineEndpointStyle(this.config.unifi.controller, infoLogger),
                debugLogger
            );

            let cameras = [];
            try {
                cameras = await uFlows.enumerateCameras();
            } catch (error) {
                infoLogger('Cannot get cameras: ' + error);
                return;
            }

            cameras.forEach((camera) => {
                if (camera.streams.length === 0) {
                    return;
                }

                const uuid = this.api.hap.uuid.generate(camera.id);
                const cameraAccessory = new this.PlatformAccessory(camera.name, uuid, Categories.CAMERA);
                const cameraAccessoryInfo = cameraAccessory.getService(this.Service.AccessoryInformation);
                cameraAccessoryInfo.setCharacteristic(this.Characteristic.Manufacturer, 'Ubiquiti');
                cameraAccessoryInfo.setCharacteristic(this.Characteristic.Model, camera.type);
                cameraAccessoryInfo.setCharacteristic(this.Characteristic.SerialNumber, camera.id);
                cameraAccessoryInfo.setCharacteristic(this.Characteristic.FirmwareRevision, camera.firmware);

                cameraAccessory.context.id = camera.id;
                cameraAccessory.context.motionEnabled = true;
                cameraAccessory.context.lastMotionId = null;
                cameraAccessory.context.lastMotionIdRepeatCount = 0;
                cameraAccessory.addService(new this.Service.MotionSensor(camera.name + ' Motion sensor'));
                cameraAccessory.addService(new this.Service.Switch(camera.name + ' Motion enabled'));
                cameraAccessory
                    .getService(this.Service.Switch)
                    .getCharacteristic(this.Characteristic.On)
                    .on(this.api.hap.CharacteristicEventTypes.GET, (callback: Function) => {
                        callback(null, cameraAccessory.context.motionEnabled);
                    })
                    .on(this.api.hap.CharacteristicEventTypes.SET, (value: boolean, callback: Function) => {
                        cameraAccessory.context.motionEnabled = value;
                        infoLogger('Motion detection for ' + camera.name + ' has been turned ' + (cameraAccessory.context.motionEnabled ? 'ON': 'OFF'));
                        callback();
                    });

                //Make a copy of the config so we can set each one to have its own camera sources!
                const videoConfigCopy: VideoConfig = JSON.parse(JSON.stringify(this.config.videoConfig));
                //Assign stillImageSource, source and debug (overwrite if they are present from the videoConfig, which they should not be!)
                videoConfigCopy.stillImageSource = '-i http://' + camera.ip + '/snap.jpeg';
                videoConfigCopy.source = '-rtsp_transport tcp -re -i ' + this.config.unifi.controller_rtsp + '/' + Unifi.pickHighestQualityAlias(camera.streams);
                videoConfigCopy.debug = this.config.unifi.debug;

                const cameraConfig: CameraConfig = {
                    name: camera.name,
                    videoConfig: videoConfigCopy
                };

                if (FFMPEG_PATH && FFMPEG_PATH.trim().length > 0) {
                    videoProcessor = FFMPEG_PATH;
                }

                const cameraSource = new FFMPEG(this.api.hap, cameraConfig, this.logger, videoProcessor, interfaceName);
                cameraAccessory.configureCameraSource(cameraSource);
                configuredAccessories.push(cameraAccessory);
            });
            infoLogger('Cameras: ' + configuredAccessories.length);

            try {
                const motionDetector = new MotionDetector(this.api, this.config, uFlows, cameras, infoLogger, debugLogger);
                await motionDetector.setupMotionChecking(configuredAccessories);
                infoLogger('Motion checking setup done!');
            } catch (error) {
                infoLogger('Error during motion checking setup: ' + error);
            }

            this.api.publishExternalAccessories(PLUGIN_NAME, configuredAccessories);
            infoLogger('Setup done');
        }
    }
}