FROM node:24-alpine AS development

WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web apps/web
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@learning-assessment/web", "--", "--hostname", "0.0.0.0"]

FROM development AS build
RUN npm run build:web

FROM nginx:1.27-alpine AS static
COPY --from=build /workspace/apps/web/out /usr/share/nginx/html
EXPOSE 80
