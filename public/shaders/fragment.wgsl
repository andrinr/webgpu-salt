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
const sun_pos = vec3f(5.0, 5.0, -5.0);
const ambient = 0.1;
const pi = 3.1415926535897932384626433832795;

@fragment
fn main(input: FragInput) -> @location(0) vec4f {

  let light_dir = normalize(sun_pos - input.pos);
  let light_normal_angle = dot(input.normal, light_dir);
  let eye_normal_angle = dot(input.normal, normalize(input.pos - constants.eye_pos));

  let light = min(abs(light_normal_angle) + ambient, 1.0);
  let specular = pow(max(dot(reflect(-light_dir, input.normal), normalize(input.pos - constants.eye_pos)), 0.0), 32.0);
  let distance_to_eye = length(input.pos - vec3f(0, 0, -3));
  let fresnel = min(1.0, pow(1.0 - abs(eye_normal_angle), 2.0));

  let spectrum_color = input.color;
  var color = fresnel * spectrum(sin(10*light_normal_angle * eye_normal_angle), spectrum_color);
  color += (1 - fresnel) * spectrum(sin(pi * 2 * light_normal_angle * eye_normal_angle), spectrum_color);
  color *= light;

  return vec4f(color, 1.0);
}
