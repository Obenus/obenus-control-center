# Changelog

Todos los cambios notables de este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y este proyecto se adhiere vagamente al [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

### Added
- Módulo **NOVA**: instalación, actualización, migración y supervisión centralizada del agente `obenus-nova.py`.
- UI `/nova`, panel NOVA en ficha de servidor, configuración Telegram cifrada y umbrales.
- Jobs BullMQ `nova-*`, modelos Prisma `NovaAgent` / `NovaOperation`, documentación `docs/NOVA.md`.

### Fixed
- Rutinas programadas multi-servidor: BullMQ ya no sobrescribe crons iguales entre nodos (`jobId` por servidor).

### Added (histórico)
- Documentación inicial del proyecto (README.md, architecture).
- Inicio de la Fase 1: Planificación y visión técnica completada.
- Fase 2: Instanciado proyecto Next.js 14, Tailwind, Prisma.
