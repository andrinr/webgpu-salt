import './style.css'
import { mat4, vec3, vec2, Vec2 } from 'wgpu-matrix';
import { loadCreateShaderModule } from './helpers';
import {genNoodle} from './noodle';

const PARTICLE_WORKGROUP_SIZE : number = 8;
const PARTICLE_GRID_SIZE : number = 1;
const NOODLE_SECTIONS = 128;
const NOODLE_ROTATIONAL_ELEMENTS = 8;
let NOODLE_RADIUS = 0.08;
let DT = 0.01;

const UPDATE_INTERVAL = 1000 / 60;
const EYE_POS = vec3.fromValues(0, 0, -3);
const LIGHT_POS = vec3.fromValues(3, -2, -2);

const SHADOW_MAP_SIZE = 1024;

const canvas : HTMLCanvasElement | null = document.getElementById("wgpu") as HTMLCanvasElement;
if (!canvas) throw new Error("No canvas found.");

// Resize canvas to fill window
let aspect : number = 1;
const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    aspect = canvas.width / canvas.height;
}
window.addEventListener("resize", resize);
resize();

let mousePos : Vec2 = vec2.fromValues(0, 0);
window.addEventListener("click", (e) => {
    mousePos = vec2.fromValues(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    LIGHT_POS[0] = mousePos[0] * 2 - 1;
    LIGHT_POS[1] = mousePos[1] * 2 - 1;
    updateParams();
    console.log(mousePos);
});

let bpm = 20;
let lastSpacePress = Date.now();
// recognise bpm with space bar presses
let last_beat = Date.now();
window.addEventListener("keydown", (e) => {
    if (e.key === " ") {
        NOODLE_RADIUS += 0.01;
    }
});

// Setup
if (!navigator.gpu) throw new Error("WebGPU not supported on this browser.");
const adapter : GPUAdapter | null = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No appropriate GPUAdapter found.");

const device : GPUDevice = await adapter.requestDevice();
const canvasContext : GPUCanvasContext = canvas.getContext("webgpu") as GPUCanvasContext;
const canvasFormat : GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat();
canvasContext.configure({
    device: device,
    format: canvasFormat,
});

// Initialize data on host
const params = new Float32Array([
    PARTICLE_GRID_SIZE,
    PARTICLE_GRID_SIZE,
    DT,
    NOODLE_SECTIONS,
    EYE_POS[0],
    EYE_POS[1],
    EYE_POS[2],
    NOODLE_ROTATIONAL_ELEMENTS,
    LIGHT_POS[0],
    LIGHT_POS[1],
    LIGHT_POS[2],
    NOODLE_RADIUS]);

const updateParams = () => {
    params[2] = DT;
    params[4] = EYE_POS[0];
    params[5] = EYE_POS[1];
    params[6] = EYE_POS[2];
    params[8] = LIGHT_POS[0];
    params[9] = LIGHT_POS[1];
    params[10] = LIGHT_POS[2];
    params[11] = NOODLE_RADIUS;
}

console.log(params);

const [vertexData, indexData] = genNoodle(NOODLE_SECTIONS, NOODLE_ROTATIONAL_ELEMENTS);

// Note a vec3 is 16 byte aligned
// This ordering requires less padding than the other way around
const particleInstanceByteSize =
    3 * 4 + // position (16 byte aligned)
    1 * 4 + // mass
    3 * 4 + // velocity
    1 * 4 + // lifetime
    3 * 4 + // color 
    1 * 4; // padding (Make sure particle struct is 16 byte aligned)
const numParticles = PARTICLE_GRID_SIZE * PARTICLE_GRID_SIZE * (NOODLE_SECTIONS);
// Array is initialized to 0
const particleStateArray : Float32Array = new Float32Array(numParticles * particleInstanceByteSize / 4);

for (let i = 0; i < particleStateArray.length; i += (particleInstanceByteSize / 4) * NOODLE_SECTIONS ) {
    particleStateArray[i] = Math.random() * 2 - 1; // x position
    particleStateArray[i + 1] = Math.random() * 2 - 1; // y position
    particleStateArray[i + 2] = Math.random() * 2 - 1; //z position
    particleStateArray[i + 3] = Math.random() * 0.2 + 0.1; // mass
    particleStateArray[i + 4] = (Math.random() * 2 - 1) * 0.1; // x velocity (scaled down
    particleStateArray[i + 5] = (Math.random() * 2 - 1) * 0.1; // y velocity
    particleStateArray[i + 6] = (Math.random() * 2 - 1) * 0.1; // z velocity
    particleStateArray[i + 7] = 0; // lifetime
    particleStateArray[i + 8] = Math.random() * 0.5 + 0.3; // r
    particleStateArray[i + 9] = Math.random() * 0.5 + 0.3; // r
    particleStateArray[i + 10] = Math.random() * 0.5 + 0.3; // r
}

const getMVP = (aspect : number) : Float32Array => {
    const target = vec3.fromValues(0, 0, 0);
    const up = vec3.fromValues(0, 1, 0);

    const view = mat4.lookAt(EYE_POS, target, up) as Float32Array;
    const projection = mat4.perspective(45 * Math.PI / 180, aspect, 0.1, 1000.0) as Float32Array;

    return mat4.multiply(projection, view) as Float32Array;
}

const mvp = getMVP(aspect);

// Create Buffers
console.log(params.byteLength, Math.ceil(params.byteLength / 16) * 16);
const paramsBuffer : GPUBuffer = device.createBuffer({
    label: "Params Uniform",
    // round to 16 byte alignment
    size: Math.ceil(params.byteLength / 16) * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const mvpBuffer : GPUBuffer = device.createBuffer({
    label: "modelViewProjectionMatrix Uniform",
    size: mvp.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const vertexBuffer : GPUBuffer = device.createBuffer({
    label: "Vertices",
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

const indexBuffer : GPUBuffer = device.createBuffer({
    label: "Indices",
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});

const particleStateBuffers : GPUBuffer[] = ["A", "B"].map((label) => {
    return device.createBuffer({
        label: "Particle state " + label,
        size: particleInstanceByteSize * numParticles,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
});

// Copy data from host to device
device.queue.writeBuffer(paramsBuffer, 0, params);
device.queue.writeBuffer(vertexBuffer, 0, vertexData);
device.queue.writeBuffer(indexBuffer, 0, indexData);
device.queue.writeBuffer(particleStateBuffers[1], 0, particleStateArray);

// Define vertex buffer layout
const vertexBufferLayout : GPUVertexBufferLayout = {
    arrayStride: Float32Array.BYTES_PER_ELEMENT * 2,
    attributes: [{ // 2d position dummy data
        format: "float32x2",
        offset: 0,
        shaderLocation: 0, // Position, see vertex shader
    }],
    stepMode : "vertex",
};

// Load & create shaders
let vertexShader : GPUShaderModule =
    await loadCreateShaderModule(device, "/shaders/vertex-render.wgsl", "Vertex shader");

const fragmentShader : GPUShaderModule = 
    await loadCreateShaderModule(device, "/shaders/fragment.wgsl", "Fragment shader");

const motionComputeShader : GPUShaderModule = 
    await loadCreateShaderModule(device, "/shaders/motion.wgsl", "Motion shader");

// Bind group layouts
const bindGroupLayout : GPUBindGroupLayout = device.createBindGroupLayout({
    label: "Mass / Compute bind group layout",
    entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX  | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: { type : "uniform"} // Params buffer
    }, {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage"} // MVP uniform buffer
    }, {
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage"} // Particle state input buffer
    }, {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer : { type: "storage" } // Particle state output buffer
    }]
});

// Bind groups: Connect buffer to shader, can be used for both pipelines
const bindGroups : GPUBindGroup[] = [0, 1].map((id) => {
    return device.createBindGroup({
        label: "Mass / Compute bind group " + ["A", "B"][id],
        layout: bindGroupLayout,
        entries: [{
            binding: 0,
            resource: { buffer: paramsBuffer }
        }, {
            binding: 1,
            resource: { buffer: mvpBuffer }
        }, {
            binding: 2,
            resource: { buffer: particleStateBuffers[id] }
        }, {
            binding: 3,
            resource: { buffer: particleStateBuffers[(id + 1) % 2] }
        }],
    });
});

// Pipeline layouts, can be used for both pipelines
const pipelineLayout : GPUPipelineLayout = device.createPipelineLayout({
    label: "Pipeline Layout",
    bindGroupLayouts: [ bindGroupLayout ],
});

// Pipelines
const renderPipeline : GPURenderPipeline = device.createRenderPipeline({
    label: "Renderer pipeline",
    layout: pipelineLayout,
    vertex: {
        module: vertexShader,
        entryPoint: "main",
        buffers: [vertexBufferLayout],
    },
    fragment: {
        module: fragmentShader,
        entryPoint: "main", 
        targets: [{format: canvasFormat}]
    },
    primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
    },
});

const motionPipeline = device.createComputePipeline({
    label: "Compute pipeline",
    layout: pipelineLayout,
    compute: {
        module: motionComputeShader,
        entryPoint: "main",
    }
});

let step = 0;


function update() : void {
    step++;

    DT = 0.01;
    updateParams();
    // on 4/4 beat, change DT
    let time = Date.now();
    // bpm in ms 
    let beats_per_ms = 60 / bpm * 1000;
    NOODLE_RADIUS = 0.09 * (0.05 - NOODLE_RADIUS) + NOODLE_RADIUS;
    updateParams();
 

    // if ( time - last_beat > beats_per_ms || time - last_beat < 0.01) {
    //     last_beat = time;
    //     console.log("beat");
    //     // set new random light position
    //     LIGHT_POS[0] = (Math.random() * 2 - 1) * 0.5;
    //     LIGHT_POS[1] = (Math.random() * 2 - 1) * 0.5;
    //     // NOODLE_RADIUS = 0.05;
    //     updateParams();
    // }

    console.log(DT);

    // update MVP
    device.queue.writeBuffer(mvpBuffer, 0, getMVP(aspect));
    // update params
    device.queue.writeBuffer(paramsBuffer, 0, params);

    const encoder : GPUCommandEncoder = device.createCommandEncoder();

    // Compute equations of motion
    {
        const motionPass = encoder.beginComputePass();

        motionPass.setPipeline(motionPipeline);
        motionPass.setBindGroup(0, bindGroups[step % 2]);

        const workgroupCount = Math.ceil(PARTICLE_GRID_SIZE / PARTICLE_WORKGROUP_SIZE);
        motionPass.dispatchWorkgroups(workgroupCount, workgroupCount);

        motionPass.end();
    }


    // Render particles
    {
        const particleRenderPass : GPURenderPassEncoder = encoder.beginRenderPass({
            colorAttachments: [{
                view: canvasContext.getCurrentTexture().createView(),
                // remove previous frame by 99% alpha
                loadOp: "clear",
                clearValue : {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                },
                storeOp: "store",
            }]
        });
        
        particleRenderPass.setPipeline(renderPipeline);
        particleRenderPass.setBindGroup(0, bindGroups[step % 2]);
        particleRenderPass.setVertexBuffer(0, vertexBuffer);
        particleRenderPass.setIndexBuffer(indexBuffer, "uint16");
        //particleRenderPass.draw(vertexData.length / 2, PARTICLE_GRID_SIZE * PARTICLE_GRID_SIZE);
        particleRenderPass.drawIndexed(indexData.length, PARTICLE_GRID_SIZE * PARTICLE_GRID_SIZE);
        
        particleRenderPass.end();
    }

    device.queue.submit([encoder.finish()]);
}

setInterval(update, UPDATE_INTERVAL);