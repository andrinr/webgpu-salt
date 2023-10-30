struct VertexInput {
  @location(0) pos: vec2f,
  @builtin(instance_index) instance_index: u32,
  @builtin(vertex_index) vertex_index: u32,
};

struct VertexOutput {
  @builtin(position) pos: vec4f,
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) vel: vec3f,
  @location(3) uv: vec2f,
  @location(4) color: vec3f,
};

struct Constants {
  grid : vec2f,
  dt : f32,
  noodle_sections : f32,
  eye_pos : vec3f,
  noodle_rotational_elements : f32,
  light_pos : vec3f,
  noodle_radius : f32,
}

@group(0) @binding(0) var<uniform> constants: Constants;
@group(0) @binding(1) var<storage> mvp: mat4x4<f32>;

struct Particle{
  pos: vec3<f32>, // 8 bytes, 8 byte aligned
  mass: f32, // 4 bytes, 4 byte aligned
  vel: vec3<f32>, // 8 bytes, 8 byte aligned
  lifetime: f32, // 4 bytes, 4 byte aligned
  color: vec3<f32> // 12 bytes, 4 byte aligned
}
@group(0) @binding(2) var<storage> particles: array<Particle>;

const twoPi = 6.28318530718;

@vertex
fn main(in : VertexInput) -> VertexOutput {

  let sections = u32(constants.noodle_sections);
  let elements = u32(constants.noodle_rotational_elements);

  // global id
  let noodle = in.instance_index / sections;
  let section = in.vertex_index / elements;
  let particleId = u32(in.instance_index * sections + in.vertex_index / elements);
  let particle = particles[particleId];

  let frame = vec3f(particle.vel.z, 0, -particle.vel.x);
  let tangent = normalize(cross(particle.vel, frame));
  let bitangent = normalize(cross(particle.vel, tangent));

  let pointOnCircle = f32(in.vertex_index % elements) / f32(elements);

  let uv = vec2(pointOnCircle, f32(section) / f32(sections));

  let normal = normalize(cos(pointOnCircle * twoPi) * tangent + sin(pointOnCircle * twoPi) * bitangent);

  // curve on uv.y where start and end are 0, between 0.25 and 0.75 it is 1
  let thickness_2 = 1. - abs(uv.y - 0.5) * 4.;
  
  let pos = particle.pos - normal * constants.noodle_radius * particle.mass * 10. * thickness_2;

  var output: VertexOutput;
  output.pos = mvp * vec4<f32>(pos, 1.0);
  output.vel = particle.vel;
  output.normal = normal;
  output.position = pos;
  output.uv = uv;
  output.color = particle.color;

  return output;
}