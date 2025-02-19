const fs = require('fs');
const exec = require('child_process').exec;

console.error('homebridge-unifi-protect-camera-motion postinstall script running on: ' + process.arch);
switch (process.arch) {
    case 'arm':
    case 'arm64':
        console.log('ARM/ARM64 architecture, tfjs-lib not precompiled, downloading external precompiled lib...');
        fixTensorFlowForArm();
        break;
    case 'x32':
    case 'x64':
        console.log('Supported architecture, tfjs-lib should be available!');
        break;
    default:
        console.error('Unsupported processor architecture: ' + process.arch);
}
rebuildBindings();

function fixTensorFlowForArm() {
    const content = {
        "tf-lib": "https://github.com/beele/homebridge-unifi-protect-camera-motion/blob/master/resources/tfjs-arm/libtensorflow-cpu-linux-arm-1.15.0.tar.gz?raw=true"
    };

    if (fs.existsSync(process.cwd() + '/node_modules/@tensorflow/tfjs-node/scripts/')) {
        fs.writeFileSync(process.cwd() + '/node_modules/@tensorflow/tfjs-node/scripts/custom-binary.json', JSON.stringify(content, null, 4));

        exec('npm install', {cwd: process.cwd() + '/node_modules/@tensorflow/tfjs-node/'}, (error, stdout, stderr) => {
            console.log(stdout);
            console.error(stderr);
        });
    }
}

function rebuildBindings() {
    console.log('Rebuilding node bindings...');

    exec('npm rebuild @tensorflow/tfjs-node --build-from-source', {cwd: process.cwd()}, (error, stdout, stderr) => {
        console.log(stdout);
        console.error(stderr);
    });
}