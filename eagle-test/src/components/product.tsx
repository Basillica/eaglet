// src/components/ProductCard.jsx
import { Component } from "solid-js";
import { logger } from "../utils";

const ProductCard: Component<{
  image: string;
  title: string;
  description: string;
  price: string;
}> = (props) => {
  return (
    <div class="max-w-sm rounded-lg overflow-hidden shadow-lg bg-white transform transition-transform duration-300 hover:scale-105">
      <img
        class="w-full h-48 object-cover"
        src={props.image}
        alt={props.title}
      />
      <div class="px-6 py-4">
        <div class="font-bold text-xl mb-2 text-gray-800">{props.title}</div>
        <p class="text-gray-700 text-base">{props.description}</p>
      </div>
      <div class="px-6 pt-4 pb-2 flex justify-between items-center">
        <span class="text-2xl font-bold text-blue-600">${props.price}</span>
        <button
          class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-full transition-colors duration-300"
          onClick={(e) => logger.info("ääääääääää")}
        >
          Add to Cart
        </button>
      </div>
    </div>
  );
};

export default ProductCard;
