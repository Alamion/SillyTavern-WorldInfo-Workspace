import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default (env, argv) => {
    const isProduction = argv.mode === 'production';
    return {
        entry: './src/index.ts',
        output: {
            path: path.resolve(rootDir, 'dist'),
            filename: 'index.js',
            clean: true,
        },
        devtool: isProduction ? false : 'source-map',
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/,
                },
                {
                    test: /\.scss$/,
                    use: ['style-loader', 'css-loader', 'sass-loader'],
                },
            ],
        },
        resolve: {
            extensions: ['.ts', '.tsx'],
        },
        performance: {
            hints: false,
        },
        stats: 'minimal',
    };
};
