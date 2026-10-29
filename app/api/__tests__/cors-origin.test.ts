import { describe, it, expect } from "vitest";
import { isAllowedOrigin } from "../lib/cors-origin";

describe("isAllowedOrigin", () => {
  it("放行 Tauri 自带来源", () => {
    expect(isAllowedOrigin("http://tauri.localhost")).toBe(true);
    expect(isAllowedOrigin("https://tauri.localhost")).toBe(true);
    expect(isAllowedOrigin("tauri://localhost")).toBe(true);
  });

  it("放行本机 localhost / 127.0.0.1（端口不限）", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://localhost:45123")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:3000")).toBe(true);
  });

  it("拒绝任意外部来源", () => {
    expect(isAllowedOrigin("http://evil.example")).toBe(false);
    expect(isAllowedOrigin("https://evil.example:3000")).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.7:3000")).toBe(false);
  });

  it("拒绝 localhost 前缀伪装", () => {
    expect(isAllowedOrigin("http://localhost.evil.com")).toBe(false);
    expect(isAllowedOrigin("http://tauri.localhost.evil.com")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1.evil.com")).toBe(false);
  });

  it("拒绝空值与非 http(s) 协议", () => {
    expect(isAllowedOrigin("")).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin("file://")).toBe(false);
    expect(isAllowedOrigin("chrome-extension://abcdefg")).toBe(false);
  });

  it("拒绝无法解析的畸形字符串", () => {
    expect(isAllowedOrigin("not a url")).toBe(false);
    expect(isAllowedOrigin("::::")).toBe(false);
  });
});
