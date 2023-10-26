struct FragOutput {
  @location(0) mass : vec4<f32>,
  @location(1) color : vec4<f32>,
}

struct FragInput {
  @location(0) pos : vec3f,
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
  noodle_radius : f32,
}

@group(0) @binding(0) var<uniform> constants: Constants;

fn pal(t : f32, a : vec3<f32>, b : vec3<f32>, c : vec3<f32>, d : vec3<f32>) -> vec3<f32> {
  return a + b*cos( 6.28318*(c*t+d) );
}

fn spectrum(n : f32, a : vec3<f32>) -> vec3<f32> {
  return pal( n, a,vec3f(0.5,0.5,0.5),vec3f(1.0,1.0,1.0),vec3f(0.0,0.33,0.67) );
}

// define sun position
const sun_pos = vec3f(10.0, 5.0, -5.0);
const ambient = 0.1;
const pi = 3.1415926535897932384626433832795;

var<private> rand_seed : vec2<f32>;

fn init_rand(invocation_id : u32, seed : vec4<f32>) {
  rand_seed = seed.xz;
  rand_seed = fract(rand_seed * cos(35.456+f32(invocation_id) * seed.yw));
  rand_seed = fract(rand_seed * cos(41.235+f32(invocation_id) * seed.xw));
}

fn rand() -> f32 {
  rand_seed.x = fract(cos(dot(rand_seed, vec2<f32>(23.14077926, 232.61690225))) * 136.8168);
  rand_seed.y = fract(cos(dot(rand_seed, vec2<f32>(54.47856553, 345.84153136))) * 534.7645);
  return rand_seed.y;
}

@fragment
fn main(input: FragInput) -> @location(0) vec4f {

  init_rand(u32(input.uv.x * 10000), vec4f(0.123, 0.456, 0.789, 0.987));

  // add slight noise to normal
  var normal = input.normal + 0.01 * vec3f(rand(), rand(), rand());

  // add slight pattern to normal
  normal += vec3f(0.0, 0.0, 0.04)  * (sin(10.0 * input.uv.x) + sin(10.0 * input.uv.y));

  let light_dir = normalize(sun_pos - input.pos);
  let light_normal_angle = dot(normal, light_dir);
  let eye_normal_angle = dot(normal, normalize(input.pos - constants.eye_pos));

  // blin-phong
  let halfway = normalize(light_dir + normalize(input.pos - constants.eye_pos));
  let phong_exponent = 6.0;
  let specular =  pow(max(dot(normal, halfway), 0.0), phong_exponent);

  let diffuse = max(light_normal_angle, 0.0);

  let distance_to_eye = length(input.pos - vec3f(0, 0, -3));
  let fresnel = min(1.0, pow(1.0 - abs(eye_normal_angle), 3.0));

  let spectrum_color = input.color;
  var color = vec3f(0.2);
  color += spectrum(sin(pi * 2 * light_normal_angle * eye_normal_angle), spectrum_color);
  color *= specular + diffuse + ambient;

  color += 0.5 * fresnel* spectrum(sin(10*light_normal_angle * eye_normal_angle), spectrum_color);

  return vec4f(color, 1.0);
}
