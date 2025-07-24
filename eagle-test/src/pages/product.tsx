import ProductCard from "../components/product";

const ProductPage = () => {
  return (
    <div class="p-8 bg-gray-100 min-h-screen flex justify-center items-center">
      <ProductCard
        image="https://picsum.photos/200/200?random=1"
        title="Awesome Gadget"
        description="A fantastic gadget that will revolutionize your daily life. High quality and durable."
        price="49.99"
      />
    </div>
  );
};

export default ProductPage;
