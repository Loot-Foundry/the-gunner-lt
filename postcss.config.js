module.exports = {
    parser: 'postcss-comment',
    plugins: [
        require('autoprefixer'),
        require('postcss-nested')
    ],
}